import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer, defaultImageLayer } = await import('../src/model');
const { buildJob, newDevice } = await import('../src/gcode');
const { canEnterIsolation } = await import('../src/isolation');
const rect = (id: number, x = 30): import('../src/model').Obj => ({ id, m: [1, 0, 0, 1, x, 30], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0 } });
function editor() {
  const a = rect(1), b = rect(2, 100), ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
  Object.assign(ed, { doc: newDoc(), sel: [a], tool: 'select', history: new History(), listeners: new Set(), isolation: null,
    nodeSel: new Set(), drag: null, draft: null, snapVer: 0, alignGuides: [], jointPicks: [], snapGrid: false, snapObjects: false,
    currentLayer: 0, view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {} } });
  ed.doc.objs = [a, b]; ed.doc.layers[0] = defaultLayer(0);
  ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
  return { ed, a, b };
}
const { ed, a, b } = editor(), before = ed.state();
const job = async () => { const j = await buildJob({ doc: ed.doc, layer: i => ({ ...defaultLayer(i), mode: 'line' }), imgLayer: defaultImageLayer, device: newDevice({ fw: 'grbl' }) });
  return { x: Array.from(j.moves.x), y: Array.from(j.moves.y), power: Array.from(j.moves.s) }; };
const output = await job(); assert.ok(canEnterIsolation(ed)); assert.ok(ed.isolateSelection());
assert.equal(ed.state(), before); assert.deepEqual(await job(), output); assert.equal(ed.history.position, 0);
assert.deepEqual(ed.viewObjects(), [a]); assert.equal(ed.selectable(b), false);
// Only the excluded object is present: hit-testing must skip it before asking
// for DOM-only Path2D geometry. The browser fixture covers rendered geometry.
ed.doc.objs = [b]; assert.equal(ed.hitTest({ x: 110, y: 40 }), null); ed.doc.objs = [a, b];
ed.selectAll(); assert.deepEqual(ed.sel, [a]); ed.setSel([b]); assert.equal(ed.sel.length, 0);
let snapped: unknown; const viewObjects = ed.viewObjects;
ed.viewObjects = function () { snapped = viewObjects.call(this); return snapped as import('../src/model').Obj[]; };
ed.buildSnap(); assert.deepEqual(snapped, [a]);
const c = rect(3, 150); ed.doc.objs.push(c); ed.setSel([c]); ed.emit('doc'); assert.deepEqual(ed.viewObjects(), [a, c]);
ed.leaveIsolation(); assert.deepEqual(ed.sel, [a]); assert.equal(ed.selectable(b), true);
ed.doc.objs.pop(); assert.equal(ed.state(), before);
ed.isolateSelection(); ed.load(before); assert.equal(ed.isolation, null);
ed.isolateSelection(); ed.clearPageState(); assert.equal(ed.isolation, null);
const gated = editor().ed;
for (const key of ['drag', 'draft', 'sketchEdit', 'pickHandler'] as const) {
  Object.assign(gated, { [key]: key === 'pickHandler' ? () => {} : {} }); assert.equal(canEnterIsolation(gated), false); assert.equal(gated.isolateSelection(), false); Object.assign(gated, { [key]: null });
}
console.log('Isolation: serialization/output, selection/hits, snapping, adoption, restoration, resets and edit guards passed.');
