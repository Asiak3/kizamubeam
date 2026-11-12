// Objects window context menu (issue #216) and the stacking-order commands it shares with the canvas menu.
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { objectsContextGroups } = await import('../src/objectsContext');
const { editorContextGroups } = await import('../src/editorContext');
type Obj = import('../src/model').Obj;
type ContextAction = import('../src/contextMenu').ContextAction;

const rect = (id: number, layer = 0): Obj => ({ id, m: [1, 0, 0, 1, id * 30, 30], layer, shape: { kind: 'rect', w: 20, h: 20, r: 0 } });
const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(),
  segmentSets: new Map(), handleSets: new Map(), clipboard: [], isolation: null, drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0,
  view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
ed.doc.layers[0] = defaultLayer(0); ed.doc.layers[1] = defaultLayer(1);
const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, library() {}, preview() {}, objects() {} };
let showIf: Obj[] | null = null, settings = -1, renamed = 0;
const hooks = { showIf: (objs: Obj[]) => { showIf = objs; }, layerSettings: (i: number) => { settings = i; } };
const flat = (groups: ContextAction[][]) => groups.flat().flatMap((a) => [a, ...(a.items ?? [])]);
const find = (groups: ContextAction[][], id: string) => flat(groups).find((a) => a.id === id);
const ids = () => ed.doc.objs.map((o) => o.id);

// ---------- Stacking order ----------
const [a, b, c, d, e] = [rect(1), rect(2), rect(3, 1), rect(4), rect(5)];
ed.doc.objs = [a, b, c, d, e]; // index 0 is drawn first (back)
ed.setSel([b]);
ed.restack('forward');
assert.deepEqual(ids(), [1, 3, 4, 2, 5], 'forward passes the next object on the same layer and skips other layers');
ed.restack('backward');
assert.deepEqual(ids(), [1, 3, 2, 4, 5], 'backward passes the previous object on the same layer');
ed.setSel([a, b]); ed.restack('forward');
assert.deepEqual(ids(), [3, 4, 1, 2, 5], 'adjacent selected objects move together and keep their order');
ed.setSel([e]); assert.equal(ed.canRestack('forward'), false); assert.equal(ed.canRestack('front'), false);
const before = ids().join(); ed.restack('front'); assert.equal(ids().join(), before, 'no-op without a snapshot');
ed.setSel([d, e]); ed.restack('back');
assert.deepEqual(ids(), [4, 5, 3, 1, 2], 'to back keeps the relative order of the selection');
ed.doUndo();
assert.deepEqual(ids(), [3, 4, 1, 2, 5], 'stacking change is one undo step');
ed.setSel([ed.doc.objs.find((o) => o.id === 1)!]); ed.restack('front'); assert.deepEqual(ids().at(-1), 1, 'undo restores objects; commands work on the restored ones');
assert.ok(find(editorContextGroups(ed, callbacks), 'tofront'), 'canvas menu offers the stacking commands too');

// ---------- Object rows ----------
ed.doc.objs = [a, b, c, d, e]; ed.setSel([b]);
const objTarget = (obj: Obj, top = obj, extra = {}) => ({ kind: 'obj' as const, obj, top, rename: () => { renamed++; }, ...extra });
let menu = objectsContextGroups(ed, callbacks, hooks, objTarget(b));
assert.ok(find(menu, 'rename') && find(menu, 'zoomsel') && find(menu, 'move-layer') && find(menu, 'copy'), 'object menu = panel block + canvas menu');
assert.equal(find(menu, 'objects'), undefined, '"Show Objects window" is left out');
assert.equal(find(menu, 'move-page'), undefined, 'no page submenu for single-page documents');
const topIds = menu.flat().map((x) => x.id);
assert.equal(topIds.filter((id) => id === 'move-layer').length, 1, 'the move block is not repeated from the canvas menu');
assert.ok(topIds.indexOf('zoomsel') < topIds.indexOf('move-layer') && topIds.indexOf('move-layer') < topIds.indexOf('showif'), 'move block in the panel head');
assert.ok(find(menu, 'layer:empty')?.enabled, 'move to an empty layer');
find(menu, 'layer:1')!.run();
assert.equal(b.layer, 1, 'move to layer');
assert.equal(find(objectsContextGroups(ed, callbacks, hooks, objTarget(b)), 'layer:1')!.checked, true);
find(menu, 'showif')!.run(); assert.deepEqual(showIf, [b]);
find(menu, 'rename')!.run(); assert.equal(renamed, 1);

ed.setSel([a, b]);
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(a));
assert.equal(find(menu, 'rename'), undefined, 'no rename for a multi-selection');
assert.equal(find(menu, 'group')!.enabled, true, 'group available for a multi-selection');
find(menu, 'obj-hide')!.run();
assert.ok(a.hidden && b.hidden && ed.sel.length === 0, 'hide applies to the selection and drops it');

// ---------- Hidden / locked objects ----------
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(a));
assert.deepEqual(flat(menu).map((x) => x.id), ['obj-show', 'rename'], 'hidden object: only show and rename');
find(menu, 'obj-show')!.run(); assert.equal(a.hidden, undefined);
d.locked = true;
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(d));
assert.deepEqual(flat(menu).map((x) => x.id), ['obj-unlock', 'rename']);
find(menu, 'obj-unlock')!.run(); assert.equal(d.locked, undefined);
ed.layer(1).locked = true;
assert.ok(find(objectsContextGroups(ed, callbacks, hooks, objTarget(c)), 'layer-unlock'), 'locked layer can be unlocked from an object row');
ed.layer(1).locked = false;

// ---------- Groups ----------
ed.doc.objs = [a, e]; ed.setSel([a, e]); ed.group();
const g = ed.sel[0];
let toggled = 0;
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(g, g, { group: { open: false, toggle: () => { toggled++; } } }));
assert.ok(find(menu, 'isolate')!.enabled && find(menu, 'ungroup')!.enabled);
find(menu, 'group-toggle')!.run(); assert.equal(toggled, 1);
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(a, g));
assert.ok(find(menu, 'rename') && find(menu, 'ungroup'), 'child row: rename the child, group menu for the rest');
find(menu, 'obj-hide')!.run();
assert.equal(a.hidden, true, 'hide on a child row hides only the child');
assert.equal(g.hidden, undefined);

// ---------- Layer and page rows ----------
menu = objectsContextGroups(ed, callbacks, hooks, { kind: 'layer', layer: 0 });
find(menu, 'layer-settings')!.run(); assert.equal(settings, 0);
find(menu, 'layer-output')!.run(); assert.equal(ed.layer(0).output, false);
menu = objectsContextGroups(ed, callbacks, hooks, { kind: 'page', page: 0, rename: () => { renamed++; } });
assert.equal(find(menu, 'page-delete')!.enabled, false, 'the only page cannot be deleted');
assert.equal(find(menu, 'page-open')!.enabled, false);
find(menu, 'page-duplicate')!.run(); assert.equal(ed.doc.pages.length, 2);
ed.setSel([g]);
menu = objectsContextGroups(ed, callbacks, hooks, objTarget(g, g, { group: { open: true, toggle() {} } }));
assert.equal(find(menu, `page:${ed.doc.page}`)!.enabled, false, 'current page is not a move target');
assert.equal(find(menu, `page:${1 - ed.doc.page}`)!.enabled, true);
console.log('Objects window context menu: stacking order, object/multi/group/child/blocked rows, layer and page rows passed.');
