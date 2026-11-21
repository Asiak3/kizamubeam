import './core-fixtures-env';
import assert from 'node:assert/strict';
import { deformGesture, gestureSpline, hitSpline, splineSamples } from '../src/shaperSpline';
import type { SplineGesture } from '../src/shaperSpline';
import type { Editor as EditorType } from '../src/editor';
import type { Obj, Pt } from '../src/model';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, newId } = await import('../src/model');
let count = 0;
async function test(name: string, fn: () => void | Promise<void>) { await fn(); count++; console.log(`PASS ${name}`); }
const samples = (f: (x: number) => number): Pt[] => Array.from({ length: 601 }, (_, i) => ({ x: 50 + i / 6, y: f(i / 6) }));
const event = (x: number, y: number, extra = {}) => ({ clientX: x, clientY: y, button: 0, pointerId: 1,
  shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...extra }) as PointerEvent;
function editor(): EditorType {
  const ed = Object.create(Editor.prototype) as EditorType;
  Object.assign(ed, { doc: newDoc(), sel: [], tool: 'shaper', history: new History(), view: { zoom: 2, ox: 0, oy: 0 },
    listeners: new Set(), batching: false, isolation: null, snapGrid: false, snapObjects: false, alignGuides: [],
    currentLayer: 0, snapHit: null, snapVer: 0, nodeSets: new Map(), segmentSets: new Map(), handleSets: new Map(),
    nodeSel: new Set(), jointPicks: [], clipboard: [], space: false, cursor: { x: 0, y: 0 },
    shaperSmoothing: .8, shaperTolerance: 2, shaperCloseGap: 2, shaperRecognize: false, boolKeep: false,
    canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
  ed.redraw = () => {}; ed.scheduleSave = () => {}; ed.syncTextLinks = () => {};
  return ed;
}
function session(ed: EditorType) {
  const shape: Obj = { id: newId(), m: [1, 0, 0, 1, 0, 0], layer: 0,
    shape: { kind: 'path', subs: [{ nodes: [{ x: 50, y: 80 }, { x: 150, y: 80 }], closed: false }] } };
  ed.doc.objs = [shape]; ed.sel = [shape];
  ed.shaperEdit = { points: samples(() => 80), op: 'freehand', inputs: [], keep: false,
    resultId: shape.id, position: ed.history.position, cands: [], pick: 'freehand', closed: false };
  return shape;
}
await test('601 straight samples produce two anchors and draggable tangents, not raw handles', () => {
  const s: SplineGesture = { points: samples(() => 80) }, raw = structuredClone(s.points);
  const spline = gestureSpline(s, .8);
  assert.equal(spline.path.nodes.length, 2);
  const control = spline.path.nodes[0].cout!;
  assert.deepEqual(hitSpline(spline.path, control, .1), { index: 0, which: 'cout' });
  assert.deepEqual(s.points, raw);
});
await test('smoothing finer restores detail and anchors from retained master samples', () => {
  const s: SplineGesture = { points: samples((x) => 80 + Math.sin(x * .5) * .3) }, raw = structuredClone(s.points);
  const fine = gestureSpline(s, 0), coarse = gestureSpline(s, 3);
  assert.ok(fine.path.nodes.length > coarse.path.nodes.length);
  assert.deepEqual(gestureSpline(s, 0).path, fine.path);
  assert.deepEqual(s.points, raw);
});
await test('a densely sampled smooth arc stays sparse', () => {
  const s: SplineGesture = { points: samples((x) => 80 + 20 * Math.sin(x * Math.PI / 100)) };
  assert.ok(gestureSpline(s, .8).path.nodes.length <= 8);
});
await test('tangent displacement deforms the master without discarding its sample detail', () => {
  const s: SplineGesture = { points: samples(() => 80) };
  const old = structuredClone(s.points), spline = gestureSpline(s, .8), control = spline.path.nodes[0].cout!;
  deformGesture(s, { index: 0, which: 'cout' }, { x: control.x, y: control.y + 20 }, .8);
  assert.equal(s.points.length, old.length);
  assert.deepEqual(s.points[0], old[0]); assert.deepEqual(s.points.at(-1), old.at(-1));
  assert.ok(s.points[300].y > old[300].y + 5);
  const refitted = gestureSpline(s, .2);
  assert.ok(splineSamples(refitted.path).some((p) => p.y > 85));
});
await test('anchor dragging carries its tangents and updates master endpoints', () => {
  const s: SplineGesture = { points: samples(() => 80) }, spline = gestureSpline(s, .8);
  const before = structuredClone(spline.path.nodes[0]);
  deformGesture(s, { index: 0, which: 'p' }, { x: 45, y: 90 }, .8);
  assert.equal(spline.path.nodes[0].cout!.y, before.cout!.y + 10);
  assert.deepEqual(s.points[0], { x: 45, y: 90 });
});
await test('real pointer lifecycle includes release coordinates, ignores foreign pointers, and cancels exactly', () => {
  const ed = editor(), result = session(ed), before = structuredClone(result);
  const s = ed.shaperEdit!, control = gestureSpline(s, .8).path.nodes[0].cout!, p = ed.toScreen(control);
  const raw = structuredClone(s.points);
  ed.onDown(event(p.x, p.y)); assert.equal(ed.drag?.type, 'shaper-point');
  const drag = ed.drag;
  ed.onDown(event(p.x, p.y, { pointerId: 2 })); assert.equal(ed.drag, drag);
  ed.onMove(event(p.x, p.y + 40, { pointerId: 2 })); assert.deepEqual(s.points, raw);
  ed.onMove(event(p.x, p.y + 40)); assert.notDeepEqual(s.points, raw);
  ed.cancelDrag(); assert.deepEqual(result, before); assert.deepEqual(ed.shaperEdit!.points, raw);
  ed.onDown(event(p.x, p.y)); ed.onUp(event(p.x, p.y + 30));
  assert.equal(ed.drag, null); assert.notDeepEqual(ed.shaperEdit!.points, raw);
  assert.equal(ed.history.position, 0);
});
await test('edited spline drives rectangle subtraction; smoothing refits the deformed master in one undo step', async () => {
  const ed = editor();
  const target: Obj = { id: newId(), m: [1, 0, 0, 1, 60, 40], layer: 0, shape: { kind: 'rect', w: 70, h: 80, r: 0 } };
  ed.doc.objs = [target]; ed.sel = [target];
  await ed.shaperSubtract(target, samples(() => 80));
  assert.equal(ed.history.position, 1);
  const s = ed.shaperEdit!, before = JSON.stringify(ed.doc.objs), spline = gestureSpline(s, .8), control = spline.path.nodes[0].cout!;
  deformGesture(s, { index: 0, which: 'cout' }, { x: control.x, y: control.y + 25 }, .8);
  assert.ok(ed.shaperRebuild()); assert.notEqual(JSON.stringify(ed.doc.objs), before);
  ed.shaperSmoothing = .1; assert.ok(ed.shaperRebuild());
  assert.ok(splineSamples(s.spline!.path).some((p) => p.y > 85));
  assert.equal(ed.history.position, 1);
  ed.doUndo(); assert.deepEqual(ed.doc.objs, [target]);
});
await test('failed rebuild rolls back both master samples and derived handles', () => {
  const ed = editor(), result = session(ed), before = structuredClone(result);
  const s = ed.shaperEdit!, control = gestureSpline(s, .8).path.nodes[0].cout!, p = ed.toScreen(control);
  const original = structuredClone(s);
  ed.onDown(event(p.x, p.y)); ed.shaperRebuild = () => false;
  ed.onMove(event(p.x, p.y + 30));
  assert.deepEqual(ed.shaperEdit, original); assert.deepEqual(result, before);
});
await test('near misses never replace the active session, even when dragged', () => {
  const ed = editor(); const result = session(ed), original = ed.shaperEdit;
  const control = gestureSpline(original!, .8).path.nodes[0].cout!, p = ed.toScreen(control);
  ed.onDown(event(p.x, p.y + 15));
  assert.ok(!ed.drag);
  ed.onMove(event(p.x, p.y + 70)); ed.onUp(event(p.x, p.y + 70));
  assert.equal(ed.shaperEdit, original); assert.equal(ed.doc.objs[0], result);
});
await test('active Shaper is edit-only, including distant drags and re-selecting the same tool', () => {
  const ed = editor(); session(ed);
  const control = gestureSpline(ed.shaperEdit!, .8).path.nodes[0].cout!, p = ed.toScreen(control);
  ed.onDown(event(p.x, p.y + 8)); assert.equal(ed.drag?.type, 'shaper-point'); ed.cancelDrag();
  const original = ed.shaperEdit;
  ed.onDown(event(400, 400)); ed.onUp(event(403, 402));
  assert.equal(ed.shaperEdit, original);
  let started = false; ed.finishShaper = async () => { started = true; };
  ed.onDown(event(400, 400)); ed.onMove(event(430, 400)); ed.onUp(event(480, 400));
  assert.equal(started, false); assert.equal(ed.shaperEdit, original); assert.equal(ed.drag, null);
  ed.setTool('shaper'); assert.equal(ed.shaperEdit, original);
  ed.setTool('select'); assert.equal(ed.shaperEdit, null);
  ed.setTool('shaper');
  ed.onDown(event(400, 400)); ed.onUp(event(430, 400)); assert.equal(started, true);
});
await test('leaving Shaper during a handle drag cancels it without resurrecting the session', () => {
  const ed = editor(), result = session(ed), before = structuredClone(result);
  const control = gestureSpline(ed.shaperEdit!, .8).path.nodes[0].cout!, p = ed.toScreen(control);
  ed.onDown(event(p.x, p.y)); ed.onMove(event(p.x, p.y + 40));
  ed.setTool('select');
  assert.equal(ed.shaperEdit, null); assert.equal(ed.drag, null); assert.deepEqual(result, before);
});
await test('anchors and tangents use grid snapping, including release coordinates and Ctrl override', () => {
  for (const which of ['p', 'cout'] as const) {
    const ed = editor(); session(ed); ed.snapGrid = true; ed.gridStep = 10;
    const node = gestureSpline(ed.shaperEdit!, .8).path.nodes[0];
    const start = ed.toScreen(which === 'p' ? node : node.cout!);
    ed.onDown(event(start.x, start.y));
    const end = ed.toScreen({ x: 63, y: 94 });
    ed.onUp(event(end.x, end.y));
    const moved = ed.shaperEdit!.spline!.path.nodes[0];
    assert.deepEqual(which === 'p' ? { x: moved.x, y: moved.y } : moved.cout, { x: 60, y: 90 });
    const again = ed.toScreen(which === 'p' ? moved : moved.cout!);
    ed.onDown(event(again.x, again.y)); ed.onUp(event(end.x, end.y, { ctrlKey: true }));
    const free = ed.shaperEdit!.spline!.path.nodes[0];
    assert.deepEqual(which === 'p' ? { x: free.x, y: free.y } : free.cout, { x: 63, y: 94 });
  }
});
await test('object snapping excludes the rebuilt result and retains normal marker feedback', () => {
  const ed = editor(); session(ed); ed.snapObjects = true;
  const target: Obj = { id: newId(), layer: 0, m: [1, 0, 0, 1, 180, 120], shape: { kind: 'rect', w: 20, h: 20, r: 0 } };
  ed.doc.objs.push(target);
  const start = ed.toScreen({ x: 50, y: 80 }); ed.onDown(event(start.x, start.y));
  const end = ed.toScreen({ x: 179, y: 119 }); ed.onMove(event(end.x, end.y));
  const node = ed.shaperEdit!.spline!.path.nodes[0];
  assert.deepEqual({ x: node.x, y: node.y }, { x: 180, y: 120 });
  assert.deepEqual(ed.snapHit?.p, { x: 180, y: 120 });
  // The old result lies on y=80; it must not pull a handle back onto itself.
  const nearSelf = ed.toScreen({ x: 100, y: 81 }); ed.onMove(event(nearSelf.x, nearSelf.y));
  assert.equal(ed.shaperEdit!.spline!.path.nodes[0].y, 81); assert.equal(ed.snapHit, null);
});
await test('Shaper tangent handles snap to visible guides', () => {
  const ed = editor(); session(ed); ed.snapObjects = true;
  ed.guidesShown = () => true; ed.guideList = () => [{ axis: 'x', v: 170 }];
  const control = gestureSpline(ed.shaperEdit!, .8).path.nodes[0].cout!, start = ed.toScreen(control);
  ed.onDown(event(start.x, start.y));
  const end = ed.toScreen({ x: 169, y: 100 }); ed.onMove(event(end.x, end.y));
  assert.deepEqual(ed.shaperEdit!.spline!.path.nodes[0].cout, { x: 170, y: 100 });
  assert.ok(ed.snapHit);
});
await test('subtraction retains the replaced rectangle as a stable snap target', async () => {
  const ed = editor(); ed.snapObjects = true;
  const target: Obj = { id: newId(), m: [1, 0, 0, 1, 60, 40], layer: 0, shape: { kind: 'rect', w: 70, h: 80, r: 0 } };
  ed.doc.objs = [target]; ed.sel = [target];
  await ed.shaperSubtract(target, samples(() => 80));
  assert.ok(!ed.doc.objs.includes(target));
  const control = gestureSpline(ed.shaperEdit!, .8).path.nodes[0].cout!;
  const start = ed.toScreen(control); ed.onDown(event(start.x, start.y));
  const end = ed.toScreen({ x: 61, y: 41 }); ed.onMove(event(end.x, end.y));
  assert.deepEqual(ed.shaperEdit!.spline!.path.nodes[0].cout, { x: 60, y: 40 });
  assert.deepEqual(ed.snapHit?.p, { x: 60, y: 40 });
  const edge = ed.toScreen({ x: 61, y: 68 }); ed.onMove(event(edge.x, edge.y));
  assert.deepEqual(ed.shaperEdit!.spline!.path.nodes[0].cout, { x: 60, y: 68 });
  ed.onUp(event(edge.x, edge.y));
  assert.deepEqual(ed.shaperEdit!.spline!.path.nodes[0].cout, { x: 60, y: 68 });
});
console.log(`${count} Shaper spline tests passed`);
