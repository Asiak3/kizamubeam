import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer } = await import('../src/model');
const { editorContextGroups } = await import('../src/editorContext');
const { commandKey, commandMatches } = await import('../src/commandKeys');
type Obj = import('../src/model').Obj;
const a: Obj = { id: 1, m: [1, 0, 0, 1, 30, 30], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0 } };
const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [a], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(), segmentSets: new Map(), handleSets:new Map(), clipboard: [],
  drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.doc.objs = [a]; ed.doc.layers[0] = defaultLayer(0); ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, library() {}, preview() {}, objects() {} };
const entries = (blank = false) => editorContextGroups(ed, callbacks, blank).flat().flatMap(a => [a, ...(a.items ?? [])]);
assert.ok(entries().some(e => e.id === 'tool:node')); assert.ok(!entries().some(e => e.id === 'trace'));
ed.tool = 'node'; assert.ok(entries().some(e => e.id === 'delete') && entries().some(e => e.id === 'node-corner'));
ed.tool = 'select'; const image: Obj = { ...a, id: 2, shape: { kind: 'image', asset: 'offline', w: 20, h: 20, adjust: {} } as Obj['shape'] };
ed.doc.objs.push(image); ed.setSel([image]); assert.equal(entries().find(e => e.id === 'trace')!.enabled, true);
const image2 = { ...image, id: 3 }; ed.doc.objs.push(image2); ed.setSel([image, image2]);
assert.equal(entries().find(e => e.id === 'trace')!.enabled, false); assert.equal(entries().find(e => e.id === 'save-bitmap')!.enabled, false);
assert.ok(entries(true).every(e => e.id !== 'delete')); assert.equal(commandKey('copy'), 'Ctrl+C');
const key = { key: 'c', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false } as KeyboardEvent;
assert.ok(commandMatches('copy', key)); assert.equal(commandMatches('copy', { ...key, altKey: true }), false);
ed.draft = { nodes: [{ x: 40, y: 40 }, { x: 60, y: 40 }], closed: false };
ed.onDown({ button: 2, clientX: 60, clientY: 40, pointerId: 1 } as PointerEvent); assert.equal(ed.suppressContextMenu, true);

// Right-drag panning (opt-in): a drag pans and keeps the line, a click without moving is a right click on release
const right = (type: 'down' | 'move' | 'up', x: number, y: number) =>
  ed[type === 'down' ? 'onDown' : type === 'move' ? 'onMove' : 'onUp']({ button: 2, clientX: x, clientY: y, pointerId: 2 } as PointerEvent);
const line = () => ({ nodes: [{ x: 40, y: 40 }, { x: 60, y: 40 }], closed: false });
ed.rightPan = true; ed.suppressContextMenu = false; ed.draft = line();
right('down', 100, 100); assert.equal(ed.drag?.type, 'right'); assert.ok(ed.draft, 'press alone keeps the line');
right('move', 103, 102); assert.deepEqual([ed.view.ox, ed.view.oy], [0, 0], 'below the threshold the view stays');
right('move', 130, 90); assert.deepEqual([ed.view.ox, ed.view.oy], [30, -10], 'pans from the press point');
right('up', 130, 90); assert.equal(ed.drag, null); assert.ok(ed.draft, 'a right drag does not finish the line');
assert.equal(ed.suppressContextMenu, true, 'the contextmenu after release (Windows) is swallowed');
ed.suppressContextMenu = false;
right('down', 130, 90); right('up', 131, 90); assert.equal(ed.draft, null, 'a click without moving finishes the line');
assert.equal(ed.suppressContextMenu, true);
ed.suppressContextMenu = false;
right('down', 50, 50); right('up', 50, 50); assert.equal(ed.suppressContextMenu, false, 'blank click: the native menu opens on release');
// WebKit sends contextmenu on press: held while the button is down, opened on release without moving
(globalThis as Record<string, unknown>).MouseEvent ??= class { constructor(public type: string, init: object) { Object.assign(this, init); } };
let menus = 0; ed.onCanvasContext = () => void menus++;
right('down', 50, 50); (ed.drag as { context: boolean }).context = true; right('up', 50, 50);
assert.equal(menus, 1); assert.equal(ed.suppressContextMenu, false);
right('down', 50, 50); (ed.drag as { context: boolean }).context = true; right('move', 80, 50); right('up', 80, 50);
assert.equal(menus, 1, 'no menu after a pan'); assert.equal(ed.suppressContextMenu, false, 'nothing left to swallow');
// Setting off: the right button works as before
ed.rightPan = false; ed.draft = line(); right('down', 50, 50); assert.equal(ed.drag, null); assert.equal(ed.draft, null);
console.log('Context menus: vector/image/node/blank variants, disabled commands, exact modifiers, reserved right-click gesture and right-drag panning passed.');
