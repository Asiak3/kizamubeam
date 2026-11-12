// "Baugruppe auswählen" and "Baugruppe auf Layer verschieben" (issue #237): where the parts are, what gets
// selected, bringing parts from other pages, one undo step, and the engraving staying on its layer.
// Run: npm run test:generators
import './core-fixtures-env';
import assert from 'node:assert/strict';
const { Editor } = await import('../src/editor');
const { History } = await import('../src/history');
const { newDoc, defaultLayer, translate, IDENT } = await import('../src/model');
const { editorContextGroups } = await import('../src/editorContext');
const { asmParts } = await import('../src/editor/generators');
const { t } = await import('../src/i18n');
type Obj = import('../src/model').Obj;

const square = [{ closed: true, nodes: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] }];
const part = (id: number, key: string, x: number, layer = 0, asm = 'A'): Obj =>
  ({ id, m: translate(x, 0), layer, shape: { kind: 'gen', gen: 'box', v: 1, params: {}, subs: square, part: key, asm } });

const a = part(1, 'front', 0);
const b = { ...part(2, 'back', 0), m: IDENT };
const mark: Obj = { id: 3, m: IDENT, layer: 5, shape: { kind: 'path', subs: square, mark: 'A/back' } };
const markGroup: Obj = { id: 4, m: translate(20, 0), layer: 0, shape: { kind: 'group', children: [b, mark] } };
const hidden = { ...part(5, 'left', 40), hidden: true };
const onLockedLayer = part(6, 'right', 60, 3);
const other = part(7, 'bottom', 80, 0, 'B');
const rect: Obj = { id: 8, m: translate(100, 0), layer: 0, shape: { kind: 'rect', w: 10, h: 10, r: 0 } };
const away = part(9, 'lid', 70);

const ed = Object.create(Editor.prototype) as import('../src/editor').Editor;
Object.assign(ed, { doc: newDoc(), sel: [], tool: 'select', history: new History(), listeners: new Set(), nodeSel: new Set(), nodeSets: new Map(),
  segmentSets: new Map(), handleSets: new Map(), clipboard: [], drag: null, draft: null, snapVer: 0, alignGuides: [], currentLayer: 0, hint: '',
  view: { zoom: 1, ox: 0, oy: 0 }, canvas: { style: {}, setPointerCapture() {}, getBoundingClientRect: () => ({ left: 0, top: 0 }) } });
ed.redraw = ed.scheduleSave = ed.syncTextLinks = () => {};
for (const i of [0, 3, 5]) ed.doc.layers[i] = defaultLayer(i);
ed.doc.layers[3].locked = true;
ed.doc.objs = [a, markGroup, hidden, onLockedLayer, other, rect];
ed.doc.pages.push({ name: 'Seite 2', objs: [away] });

// Menu: the entries only appear for parts of an assembly
const callbacks = { adjust() {}, trace() {}, background() {}, saveBitmap() {}, library() {}, vectorFit() {}, builder() {}, preview() {}, objects() {} };
const entries = () => editorContextGroups(ed, callbacks).flat().flatMap((e) => [e, ...(e.items ?? [])]);
ed.setSel([rect]);
assert.ok(!entries().some((e) => e.id === 'asm-select' || e.id === 'asm-layer'), 'no assembly entries for a plain rectangle');
ed.setSel([markGroup]);
assert.deepEqual(ed.selAsms(), ['A'], 'a part inside its engraving group counts');
assert.ok(entries().some((e) => e.id === 'asm-select') && entries().some((e) => e.id === 'asm-layer'));
assert.equal(entries().find((e) => e.id === 'asm-layer:0')!.checked, false, 'not all parts are on layer 0 yet');

// Status: per top-level object
const st = ed.asmStatus(['A']);
assert.deepEqual(st.ready.map((x) => x.top), [a, markGroup]);
assert.deepEqual(st.hidden.map((x) => x.top), [hidden]);
assert.deepEqual(st.away.map((x) => [x.top, x.page]), [[away, 1]]);
assert.deepEqual(st.blocked.map((x) => x.top), [onLockedLayer], 'a locked layer is not changed');
assert.equal(asmParts([...st.ready, ...st.hidden, ...st.away, ...st.blocked]), 5);

// Only the available parts: nothing changes in the document
const before = JSON.stringify(ed.doc);
assert.equal(ed.selectAsm(['A']), 3);
assert.deepEqual(ed.sel, [a, markGroup]);
assert.equal(JSON.stringify(ed.doc), before, 'the document is unchanged');
assert.match(ed.hint, /^3 /, 'the status bar names the missing parts');

// Bring all here: the part from page 2 keeps its position, the hidden one is shown, one undo step
const steps = ed.history.position;
assert.equal(ed.selectAsm(['A'], true), 1, 'only the part on the locked layer is left out');
assert.deepEqual(ed.sel, [a, markGroup, hidden, away]);
assert.ok(ed.doc.objs.includes(away) && !ed.doc.pages[1].objs.includes(away));
assert.deepEqual(away.m, translate(70, 0));
assert.equal(hidden.hidden, undefined);
assert.equal(onLockedLayer.layer, 3);
assert.ok(ed.doc.layers[3].locked);
assert.equal(ed.history.position, steps + 1, 'one undo step');
assert.equal(ed.history.nextUndo(), t('Teile der Baugruppe zusammenholen'));
ed.doUndo();
assert.equal(ed.doc.pages[1].objs.length, 1, 'undo puts the part back on page 2');
assert.ok(ed.doc.objs.find((o) => o.id === 5)!.hidden, 'undo hides the part again');

// Move the assembly to another layer: all pages, the engraving stays, other assemblies stay
const find = (id: number): Obj => { for (const pg of ed.doc.pages) for (const o of pg.objs) {
  if (o.id === id) return o;
  if (o.shape.kind === 'group') for (const c of o.shape.children) if (c.id === id) return c;
} throw new Error(`no ${id}`); };
ed.assignAsmLayer(['A'], 7);
for (const id of [1, 2, 5, 6, 9]) assert.equal(find(id).layer, 7, `part ${id} on layer 7`);
assert.equal(find(4).layer, 7, 'the engraving group follows its part');
assert.equal(find(3).layer, 5, 'the engraving stays on its layer');
assert.equal(find(7).layer, 0, 'other assembly unchanged');
assert.ok(ed.asmOnLayer(['A'], 7));

// Empty layer: lowest number no object uses on any page, saved settings or not
assert.equal(ed.freeLayer(), 1);
ed.doc.pages[1].objs.push({ ...rect, id: 10, layer: 1 });
assert.equal(ed.freeLayer(), 2, 'a layer used only on another page is not empty');
assert.equal(ed.freeLayer(2), 3, 'layer 3 has saved settings but no objects: it is empty');
assert.equal(ed.freeLayer(2, true), 4, 'for the engraving a layer without saved settings comes first');

// Canvas menu: select block and move block in the agreed order, empty layer in both layer submenus
ed.setSel([find(1)]);
let groups = editorContextGroups(ed, callbacks);
const select = groups.find((g) => g.some((e) => e.id === 'selectall'))!.map((e) => e.id);
assert.deepEqual(select.slice(0, 3), ['selectall', 'asm-select', 'layer-objects']);
assert.deepEqual(groups.find((g) => g.some((e) => e.id === 'move-layer'))!.map((e) => e.id), ['move-layer', 'asm-layer', 'move-page', 'asm-page']);
assert.ok(entries().some((e) => e.id === 'layer:empty') && entries().some((e) => e.id === 'asm-page:new'));
assert.ok(entries().find((e) => e.id === 'layer:empty')!.label.includes('02 · C02'), 'the label names the empty layer');
const layersBefore = Object.keys(ed.doc.layers).join();
groups = editorContextGroups(ed, callbacks);
assert.equal(Object.keys(ed.doc.layers).join(), layersBefore, 'opening the menu stores no settings for the empty layer');
groups.flat().find((e) => e.id === 'asm-layer')!.items!.find((e) => e.id === 'asm-layer:empty')!.run();
for (const id of [1, 2, 5, 6, 9]) assert.equal(find(id).layer, 2, `part ${id} on the empty layer`);
ed.setSel([find(8)]);
groups = editorContextGroups(ed, callbacks);
assert.ok(!groups.flat().some((e) => e.id === 'asm-layer' || e.id === 'asm-page'), 'no assembly moves for a plain object');

// Select objects on this layer: the plain rectangle and the other assembly share layer 0, the parts moved away
ed.selectLayerObjects();
assert.deepEqual(ed.sel.map((o) => o.id).sort(), [7, 8]);

// Move the assembly to another page: same position, one undo step, the current page stays
const pos = JSON.stringify(find(1).m);
const page0 = ed.doc.page, steps2 = ed.history.position;
ed.moveAsmToPage(['A'], 1);
assert.ok(ed.asmOnPage(['A'], 1) && ed.doc.page === page0);
assert.equal(JSON.stringify(find(1).m), pos);
assert.equal(ed.history.position, steps2 + 1);
assert.equal(ed.history.nextUndo(), t('Baugruppe auf Seite verschieben'));
ed.doUndo();
assert.ok(!ed.asmOnPage(['A'], 1), 'undo puts the parts back');
// New page: created behind the current one, opened, with the assembly selected
const pages = ed.doc.pages.length;
ed.moveAsmToPage(['A'], 'new');
assert.equal(ed.doc.pages.length, pages + 1);
assert.equal(ed.doc.page, page0 + 1);
assert.ok(ed.asmOnPage(['A'], ed.doc.page));
assert.ok(ed.sel.length > 0 && ed.sel.every((o) => ed.doc.objs.includes(o)), 'the moved parts are selected on the new page');
ed.doUndo();
assert.equal(ed.doc.pages.length, pages, 'one undo step removes the new page again');
console.log('Select assembly: menu order, status, available only, gather with one undo step, move to layer/empty layer/page/new page, select layer objects passed.');
