// Moving groups with objects on several layers (#255): when to ask, "preserve" vs "all", nested groups,
// cancel without changes, drag and drop, the agent command. Run: npm run test:layer-assign
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer, translate, IDENT, homeLayer, leaves } = await import('../src/model');
const { assignLayerAsk, moveObjectsAsk } = await import('../src/layerAssign');
type Obj = import('../src/model').Obj;
type ChildLayers = import('../src/model').ChildLayers;

const square = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
const path = (id: number, layer: number, mark?: string): Obj => ({ id, m: translate(id * 20, 0), layer, shape: { kind: 'path', subs: square, ...(mark ? { mark } : {}) } });
const group = (id: number, children: Obj[]): Obj => ({ id, m: IDENT, layer: homeLayer({ id, m: IDENT, layer: 0, shape: { kind: 'group', children } }), shape: { kind: 'group', children } });

const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(),
  segmentSets: new Map(), handleSets: new Map(), clipboard: [], isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0,
  activeLayer: 0, hint: '', view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
for (const i of [0, 1, 2, 5]) ed.doc.layers[i] = defaultLayer(i);

/** Fake dialog: records the call and answers */
let asked = 0;
const answer = (a: ChildLayers | null) => async () => (asked++, a);
const layers = (o: Obj) => [...leaves([o])].map(([l]) => l.layer);
const reset = (objs: Obj[]) => { ed.doc.objs = objs; ed.setSel(objs); ed.currentLayer = ed.activeLayer = 0; asked = 0; };

// Loose objects on different layers: no question, all move
let a = path(1, 0), b = path(2, 1);
reset([a, b]);
await assignLayerAsk(ed, 3, answer(null));
assert.equal(asked, 0, 'loose objects on different layers do not ask');
assert.deepEqual([a.layer, b.layer], [3, 3]);

// Group on a single layer: no question, everything and the group move
let g = group(10, [path(11, 1), path(12, 1)]);
reset([g]);
await assignLayerAsk(ed, 3, answer(null));
assert.equal(asked, 0, 'a group on one layer does not ask');
assert.deepEqual(layers(g), [3, 3]); assert.equal(g.layer, 3);

// Part (0) + engraving (5): mixed
const markGroup = () => group(20, [path(21, 0), path(22, 5, 'A/front')]);
g = markGroup(); reset([g]);
await assignLayerAsk(ed, 3, answer('preserve'));
assert.equal(asked, 1);
assert.deepEqual(layers(g), [3, 5], 'preserve: the part moves, the engraving stays');
assert.equal(g.layer, 3); assert.equal(ed.currentLayer, 3);
g = markGroup(); reset([g]);
await assignLayerAsk(ed, 3, answer('all'));
assert.deepEqual(layers(g), [3, 3], 'all: everything moves'); assert.equal(g.layer, 3);

// Cancel: document, current layer and undo stay as they were
g = markGroup(); reset([g]);
const before = JSON.stringify(ed.doc), steps = ed.history.position, layerKeys = Object.keys(ed.doc.layers).join();
await assignLayerAsk(ed, 7, answer(null));
assert.equal(asked, 1);
assert.equal(JSON.stringify(ed.doc), before, 'cancel changes nothing');
assert.equal(Object.keys(ed.doc.layers).join(), layerKeys, 'no settings stored for the target layer');
assert.equal(ed.currentLayer, 0, 'cancel keeps the current layer'); assert.equal(ed.activeLayer, 0);
assert.equal(ed.history.position, steps, 'cancel adds no undo step');

// One undo step for the move
g = markGroup(); reset([g]);
const steps2 = ed.history.position;
await assignLayerAsk(ed, 3, answer('preserve'));
assert.equal(ed.history.position, steps2 + 1);
ed.doUndo();
assert.deepEqual(layers(ed.doc.objs[0]), [0, 5], 'undo restores the layers');

// Several groups: each one is checked with its own homeLayer; one question for all
const g1 = group(30, [path(31, 0), path(32, 5)]), g2 = group(40, [path(41, 1), path(42, 5)]), loose = path(50, 2);
reset([g1, g2, loose]);
await assignLayerAsk(ed, 3, answer('preserve'));
assert.equal(asked, 1, 'one question for the whole selection');
assert.deepEqual([layers(g1), layers(g2), loose.layer], [[3, 5], [3, 5], 3]);

// A group already on the target layer needs no question
g = markGroup(); reset([g]);
await assignLayerAsk(ed, 0, answer(null));
assert.equal(asked, 0); assert.deepEqual(layers(g), [0, 5]);

// Nested groups keep consistent layers: every group gets the layer of its first object
let inner = group(61, [path(62, 0), path(63, 2)]);
let outer = group(60, [path(64, 0), inner]);
reset([outer]);
await assignLayerAsk(ed, 3, answer('preserve'));
assert.deepEqual(layers(outer), [3, 3, 2]);
assert.equal(inner.layer, 3); assert.equal(outer.layer, 3);
inner = group(71, [path(72, 2), path(73, 0)]);
outer = group(70, [inner, path(74, 2), path(75, 0)]);
reset([outer]);
await assignLayerAsk(ed, 3, answer('preserve'));
assert.deepEqual(layers(outer), [3, 0, 3, 0], 'homeLayer of the outer group (2) moves, layer 0 stays');
assert.equal(inner.layer, 3); assert.equal(outer.layer, 3);
outer = group(80, [group(81, [path(82, 2), path(83, 0)]), path(84, 0)]);
reset([outer]);
await assignLayerAsk(ed, 3, answer('all'));
assert.deepEqual(layers(outer), [3, 3, 3]);
assert.equal((outer.shape as { children: Obj[] }).children[0].layer, 3, 'all: nested group layers follow');

// Drag and drop in the Objects window: cancel keeps order and layers, preserve keeps the engraving
g = markGroup(); const other = path(90, 1); reset([g, other]);
const order = () => ed.doc.objs.map((o) => o.id).join();
const orderBefore = order(), docBefore = JSON.stringify(ed.doc);
await moveObjectsAsk(ed, [g], other, true, 1, answer(null));
assert.equal(asked, 1); assert.equal(order(), orderBefore); assert.equal(JSON.stringify(ed.doc), docBefore, 'cancelled drop changes nothing');
await moveObjectsAsk(ed, [g], other, true, 1, answer('preserve'));
assert.equal(order(), '90,20'); assert.deepEqual(layers(g), [1, 5]);
// Reordering on the same layer does not ask
asked = 0;
await moveObjectsAsk(ed, [g], other, false, 1, answer(null));
assert.equal(asked, 0); assert.equal(order(), '20,90');

// Manual assignment per layer for the whole selection: only the changed rows move, the rest stays
let seen: Obj[] = [];
const map = (pairs: [number, number][]) => async (_e: unknown, _g: Obj[], _t: number, objs: Obj[]) => (asked++, (seen = objs), new Map(pairs));
g = markGroup(); a = path(95, 1); reset([g, a]);
await assignLayerAsk(ed, 3, map([[0, 3], [5, 7]]));
assert.equal(asked, 1);
assert.deepEqual(seen, [g, a], 'the dialog gets the whole selection, loose objects too');
assert.deepEqual(layers(g), [3, 7], 'manual: part to 3, engraving to 7'); assert.equal(g.layer, 3);
assert.equal(a.layer, 1, 'manual: a loose object without a changed row stays');
// Group on two layers + loose rectangle + jig: only the loose rectangle's layer changes
const pair = group(120, [path(121, 1), path(122, 2)]), lone = path(123, 4), jig = group(124, [path(125, 1), path(126, 3, 'reg')]);
reset([pair, lone, jig]);
await assignLayerAsk(ed, 9, map([[4, 6]]));
assert.deepEqual([layers(pair), lone.layer, layers(jig)], [[1, 2], 6, [1, 3]], 'manual: only the loose rectangle moves');
assert.deepEqual([pair.layer, jig.layer], [1, 1]);
g = markGroup(); reset([g]);
await assignLayerAsk(ed, 3, map([[5, 2]]));
assert.deepEqual(layers(g), [0, 2], 'manual: only the engraving changes, the part stays'); assert.equal(g.layer, 0);
g = markGroup(); reset([g]);
const docManual = JSON.stringify(ed.doc), stepsManual = ed.history.position;
await assignLayerAsk(ed, 3, map([]));
assert.equal(JSON.stringify(ed.doc), docManual, 'manual without changes: the group stays as it is');
assert.equal(ed.history.position, stepsManual + 1, 'one undo step');
// Nested groups with a manual map keep consistent group layers
inner = group(101, [path(102, 2), path(103, 0)]);
outer = group(100, [inner, path(104, 0)]);
reset([outer]);
await assignLayerAsk(ed, 3, map([[2, 4], [0, 6]]));
assert.deepEqual(layers(outer), [4, 6, 6]);
assert.equal(inner.layer, 4); assert.equal(outer.layer, 4);
// Drag and drop with a manual map
g = markGroup(); const target = path(110, 1); reset([g, target]);
await moveObjectsAsk(ed, [g], target, true, 1, map([[0, 1], [5, 8]]));
assert.deepEqual(layers(g), [1, 8]); assert.equal(order(), '110,20');

// Agent command: preserve by default, all on request
const { EDIT_TOOLS } = await import('../src/agentedit');
const tool = EDIT_TOOLS.find((x) => x.name === 'assign_layer')!;
g = markGroup(); reset([g]);
tool.run(ed, { ids: [20], layer: 3 });
assert.deepEqual(layers(g), [3, 5], 'agent: preserve by default');
g = markGroup(); reset([g]);
tool.run(ed, { ids: [20], layer: 3, childLayers: 'all' });
assert.deepEqual(layers(g), [3, 3], 'agent: childLayers all');

console.log('Layer assignment (#255): when to ask, preserve/all/manual, several and nested groups, cancel, undo, drag and drop and the agent command passed.');
