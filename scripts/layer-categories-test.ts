// #265: Layer categories (Cut / Engrave / Mark and custom ones) and the layer defaults for new projects.
//
// layer-categories-fixtures.json records, for the code before the categories, hashes of the projects that New, a new
// tab, closing the last tab and the first launch create, and of the label layer of the generators (markLayer). Without
// stored categories (and with the built-ins unchanged) they must stay exactly the same (write it again with --write,
// only on that code). Aufruf: npm run test:layer-categories
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LayerDefaults } from '../src/layerCategories';

// ---------- Headless editor (browser objects the editor touches) ----------

const store = new Map<string, string>();
class Target {
  clientWidth = 800;
  clientHeight = 600;
  style = {};
  dataset = {};
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() { return true; }
  append() {}
  remove() {}
  setAttribute() {}
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
}
const ctx = new Proxy({ measureText: () => ({ width: 30 }), getLineDash: () => [] } as Record<string | symbol, unknown>, {
  get: (o, k) => o[k] ?? (() => {}),
});
const storage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
const lang = { language: 'de', languages: ['de'] };
if (globalThis.navigator) for (const [key, value] of Object.entries(lang)) Object.defineProperty(globalThis.navigator, key, { value, configurable: true });
else Object.assign(globalThis, { navigator: lang });
const win = Object.assign(new Target(), { devicePixelRatio: 1, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) });
Object.assign(globalThis, {
  window: win, localStorage: storage, sessionStorage: storage,
  document: Object.assign(new Target(), { documentElement: Object.assign(new Target(), { lang: 'de' }), body: new Target(), querySelector: () => null, createElement: () => Object.assign(new Target(), { getContext: () => ctx }) }),
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  ResizeObserver: class { observe() {} },
  Path2D: class { addPath() {} moveTo() {} lineTo() {} bezierCurveTo() {} quadraticCurveTo() {} arc() {} arcTo() {} ellipse() {} rect() {} roundRect() {} closePath() {} },
  DOMMatrix: class {},
  requestAnimationFrame: () => 1, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
});

const { Editor } = await import('../src/editor');
const { docKey } = await import('../src/editor/tabs');
const { defaultCutSettings, defaultLayer, defaultSubLayer, normalizeLayer } = await import('../src/model');
const { applyCategoriesToLayers, applyCategoriesToProject, builtinCategory, categoryFrom, categoryLayer, categoryName, categoryOf, defaultLayerDefaults, isBuiltinCategory, LAYER_CATEGORIES_KEY, loadLayerDefaults, newCategoryId, resetSettings, sameLayerDefaults, sanitizeLayerDefaults, saveLayerDefaults } = await import('../src/layerCategories');

const FIXTURES = new URL('./layer-categories-fixtures.json', import.meta.url);
const write = process.argv.includes('--write');

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const hash = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');
type Ed = InstanceType<typeof Editor>;
const editor = (): Ed => new Editor(Object.assign(new Target(), { getContext: () => ctx }) as unknown as HTMLCanvasElement);

/** A project with one object on layer 3 and a changed bed, so New and the tabs have something to replace */
function busy(ed: Ed) {
  ed.doc.bed = { w: 600, h: 300 };
  ed.doc.objs.push({ id: 9001, m: [1, 0, 0, 1, 10, 10], layer: 3, shape: { kind: 'rect', w: 20, h: 10, r: 0 } });
  ed.layer(3).speed = 1234;
}

/** Stored layer defaults for the next editors (null = none, as before the categories) */
let stored: string | null = null;
function reset() {
  store.clear();
  if (stored !== null) store.set(LAYER_CATEGORIES_KEY, stored);
}

/** Projects the editor creates as new ones: doc JSON and comparison key of the tab */
function record(): Record<string, string> {
  const out: Record<string, string> = {};
  const take = (name: string, ed: Ed) => {
    out[`${name}.doc`] = hash(JSON.stringify(ed.doc));
    out[`${name}.key`] = hash(docKey(ed.doc));
    out[`${name}.saved`] = String(ed.tab.saved === docKey(ed.doc));
  };
  reset();
  take('firstLaunch', editor());

  reset();
  let ed = editor();
  busy(ed);
  ed.newDocument();
  take('newDocument', ed);

  reset();
  ed = editor();
  busy(ed);
  ed.newTab();
  take('newTab', ed);

  reset();
  ed = editor();
  busy(ed);
  ed.closeTab();
  take('closeLastTab', ed);

  reset();
  ed = editor();
  const i = ed.markLayer(0);
  out['markLayer.index'] = String(i);
  out['markLayer.layers'] = hash(ed.doc.layers);
  ed.doc.objs.push({ id: 9002, m: [1, 0, 0, 1, 0, 0], layer: i, shape: { kind: 'path', subs: [], mark: 'x/0' } });
  out['markLayer.again'] = String(ed.markLayer(0));
  return out;
}

if (write) {
  writeFileSync(FIXTURES, JSON.stringify(record(), null, 2) + '\n');
  console.log('layer-categories-fixtures.json written');
  process.exit(0);
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, string>;
const withoutMark = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('markLayer.layers')));

test('compatible: no stored categories', () => {
  stored = null;
  assert.deepEqual(record(), fixtures);
});

test('compatible: stored built-ins unchanged give the same new projects', () => {
  stored = JSON.stringify(defaultLayerDefaults());
  assert.deepEqual(withoutMark(record()), withoutMark(fixtures));
});

test('compatible: "apply to new projects" off gives the same new projects', () => {
  const d = defaultLayerDefaults();
  d.apply = false;
  d.categories[0].cut.speed = 999;
  d.layers[4] = 'mark';
  stored = JSON.stringify(d);
  assert.deepEqual(withoutMark(record()), withoutMark(fixtures));
});

// ---------- Custom defaults ----------
// Cut preset 450 mm/min, layer 2 → Mark, layer 5 → custom "Pappe" (fill with a line sub-layer, type engrave),
// layer 0 stays Engrave (unchanged)
function custom(): LayerDefaults {
  const d = defaultLayerDefaults();
  d.categories.find((c) => c.id === 'cut')!.cut.speed = 450;
  d.categories.push({ id: 'pappe', name: 'Pappe', type: 'engrave', cut: { ...defaultCutSettings('fill'), speed: 2000, power: 22, sub: [{ ...defaultSubLayer('line'), speed: 900, power: 40 }] } });
  d.layers[2] = 'mark';
  d.layers[5] = 'pappe';
  return d;
}

test('new projects get the layers of their categories', () => {
  stored = JSON.stringify(custom());
  for (const make of [
    () => editor(),
    () => { const ed = editor(); busy(ed); ed.newDocument(); return ed; },
    () => { const ed = editor(); busy(ed); ed.newTab(); return ed; },
    () => { const ed = editor(); busy(ed); ed.closeTab(); return ed; },
  ]) {
    reset();
    const ed = make();
    const L = ed.doc.layers;
    assert.equal(L[0], undefined, 'layer 00 (Engrave, unchanged) stays out of the file');
    assert.equal(L[1].speed, 450);
    assert.equal(L[1].mode, 'line');
    assert.equal(L[1].layerType, undefined, 'cut on a line layer needs no stored type');
    assert.equal(L[1].name, 'C01');
    assert.deepEqual([L[2].speed, L[2].power, L[2].layerType], [3000, 15, 'mark']);
    assert.deepEqual([L[5].mode, L[5].speed, L[5].power, L[5].layerType, L[5].sub?.[0].speed], ['fill', 2000, 22, 'engrave', 900]);
    assert.equal(L[29].speed, 450);
    assert.equal(L[30], undefined, 'tool layers T1/T2 have no category');
    for (let i = 1; i < 30; i++) assert.equal(normalizeLayer(structuredClone(L[i])).dedupTol, L[i].dedupTol, `layer ${i} complete`);
    // Reading the written layers must not change the project (they are complete): the new tab stays unchanged
    for (const i of Object.keys(L)) ed.layer(Number(i));
    ed.updateChanged();
    assert.equal(ed.tab.changed, false);
    assert.equal(ed.tab.saved, docKey(ed.doc));
  }
});

test('New is one undo step back to the old project', () => {
  stored = JSON.stringify(custom());
  reset();
  const ed = editor();
  busy(ed);
  const before = JSON.stringify(ed.doc);
  ed.newDocument();
  assert.equal(ed.doc.layers[1].speed, 450);
  ed.doUndo();
  assert.equal(JSON.stringify(ed.doc), before);
});

test('restored sessions and opened files keep their layers', () => {
  stored = null;
  reset();
  let ed = editor();
  busy(ed);
  ed.saveNow();
  const saved = JSON.stringify(ed.doc);
  store.set(LAYER_CATEGORIES_KEY, JSON.stringify(custom()));
  ed = editor();
  assert.equal(JSON.stringify(ed.doc), saved);
  ed.openDoc(saved);
  assert.equal(JSON.stringify(ed.doc), saved);
});

test('label layer of the generators uses the Mark category', () => {
  const d = custom();
  d.categories.find((c) => c.id === 'mark')!.cut.power = 9;
  stored = JSON.stringify(d);
  reset();
  const ed = editor();
  const i = ed.markLayer(0);
  const L = ed.doc.layers[i];
  assert.deepEqual([L.mode, L.speed, L.power, L.layerType, L.name, L.output], ['line', 3000, 9, 'mark', 'Beschriftung', true]);
});

test('"Standardwerte" resets to the preset of the layer category with the same mode', () => {
  assert.deepEqual(resetSettings(2, 'line', null), defaultCutSettings('line'));
  assert.deepEqual(resetSettings(0, 'fill', null), defaultCutSettings('fill'));
  const d = custom();
  assert.equal(resetSettings(2, 'line', d).speed, 3000);
  assert.equal(resetSettings(2, 'line', d).power, 15);
  assert.deepEqual(resetSettings(2, 'fill', d), defaultCutSettings('fill'), 'Mark is a line category');
  const p = resetSettings(5, 'fill', d);
  assert.deepEqual([p.speed, p.sub, p.layerType, p.look], [2000, undefined, undefined, undefined]);
  assert.equal(resetSettings(7, 'line', d).speed, 450);
  assert.deepEqual(resetSettings(31, 'line', d), defaultCutSettings('line'), 'tool layers keep the plain defaults');
});

test('stored data is checked', () => {
  assert.deepEqual(sanitizeLayerDefaults(null), defaultLayerDefaults());
  assert.deepEqual(sanitizeLayerDefaults('x'), defaultLayerDefaults());
  const d = sanitizeLayerDefaults({
    apply: 'no',
    categories: [
      { id: 'mark', name: ' Ritzen ', cut: { mode: 'weird', speed: 100, layerType: 'cut', look: { id: 'nope' } } },
      { id: 'own', type: 'nonsense', cut: null },
      { id: 'own', name: 'duplicate' },
      { id: '', name: 'no id' },
      7,
    ],
    layers: { 3: 'own', 4: 'gone', 31: 'mark', x: 'mark', 0: 'engrave' },
  });
  assert.equal(d.apply, true, 'only false switches it off');
  assert.deepEqual(d.categories.map((c) => c.id), ['cut', 'engrave', 'mark', 'own']);
  const mark = d.categories[2];
  assert.deepEqual([mark.name, mark.type, mark.cut.mode, mark.cut.speed, mark.cut.layerType, mark.cut.look], ['Ritzen', 'mark', 'line', 100, undefined, undefined]);
  assert.equal(mark.cut.dedupTol, 0.05, 'missing settings filled in');
  const own = d.categories[3];
  assert.deepEqual([own.type, own.cut.speed], ['cut', 600]);
  assert.deepEqual(d.layers, { 3: 'own' });
  assert.equal(categoryName(mark), 'Ritzen');
  assert.equal(categoryName(d.categories[1]), 'Gravieren');
  // Round trip through the store
  saveLayerDefaults(d);
  assert.deepEqual(loadLayerDefaults(), d);
  saveLayerDefaults(null);
  assert.equal(loadLayerDefaults(), null);
  store.set(LAYER_CATEGORIES_KEY, '{broken');
  assert.equal(loadLayerDefaults(), null);
});

test('categoryOf falls back to the standard category', () => {
  const d = custom();
  assert.equal(categoryOf(5, d).id, 'pappe');
  assert.equal(categoryOf(0, d).id, 'engrave');
  assert.equal(categoryOf(9, d).id, 'cut');
  assert.equal(categoryOf(9, null).cut.speed, 600);
  d.layers[9] = 'missing';
  assert.equal(categoryOf(9, d).id, 'cut');
  assert.deepEqual(categoryLayer(0, builtinCategory('engrave')), defaultLayer(0));
  assert.deepEqual(categoryLayer(4, builtinCategory('cut')), defaultLayer(4));
});

// ---------- Dialog „Layer-Vorgaben“ (PR 3) ----------
/** Der Knopf „Auf dieses Projekt anwenden“ (gleiche Funktion wie im Dialog); true = etwas geändert */
const applyToProject = (ed: Ed, d: LayerDefaults) => applyCategoriesToProject(ed, d, 'apply').changed.length > 0;

test('"Apply to this project" sets the settings and the standard name, keeps output, order, image settings, lock and 3D look', () => {
  stored = null;
  reset();
  const ed = editor();
  busy(ed);
  Object.assign(ed.layer(3), { name: 'Pappel 3 mm Schneiden', output: false, show: false, priority: 2, locked: true, material: 'm1', look: { id: 'birch' }, img: { dpi: 254 } });
  ed.layer(30).speed = 77;
  const before = JSON.stringify(ed.doc);
  assert.equal(applyToProject(ed, custom()), true);
  const L = ed.doc.layers;
  assert.deepEqual([L[3].speed, L[3].power, L[3].mode], [450, 80, 'line']);
  assert.deepEqual([L[3].name, L[3].output, L[3].show, L[3].priority, L[3].locked], ['C03', false, false, 2, true], 'changed values: standard name');
  assert.deepEqual(L[3].look, { id: 'birch' }, 'the category has no look: the layer keeps its own');
  assert.equal((L[3].img as { dpi?: number }).dpi, 254);
  assert.equal(L[3].material, undefined, 'values no longer come from the library entry');
  assert.deepEqual([L[2].speed, L[2].power, L[2].layerType], [3000, 15, 'mark']);
  assert.deepEqual([L[5].mode, L[5].layerType, L[5].sub?.[0].speed], ['fill', 'engrave', 900]);
  assert.equal(L[30].speed, 77, 'tool layers stay');
  assert.equal(normalizeLayer(structuredClone(L[3])).dedupTol, L[3].dedupTol, 'layer complete');
  assert.deepEqual(applyCategoriesToLayers(structuredClone(ed.doc.layers), sanitizeLayerDefaults(custom())), [], 'second time: nothing to change');
  assert.equal(applyToProject(ed, custom()), false, 'no undo step without a change');
  ed.doUndo();
  assert.equal(JSON.stringify(ed.doc), before, 'one undo step back');
});

test('"Apply to this project": unchanged layers keep name and library link, layers with images stay', () => {
  stored = null;
  reset();
  const ed = editor();
  busy(ed);
  // Layer 1: same values as its category (Cut 450), name and link from the library stay
  Object.assign(ed.layer(1), { speed: 450, name: 'Pappel 3 mm Schneiden', material: 'm1' });
  // Layer 4: an image on the second page; its speed is also the image speed
  ed.layer(4).speed = 3000;
  ed.doc.pages.push({ name: 'P2', objs: [{ id: 9002, m: [1, 0, 0, 1, 0, 0], layer: 4, shape: { kind: 'group', children: [{ id: 9003, m: [1, 0, 0, 1, 0, 0], layer: 4, shape: { kind: 'image', w: 10, h: 10, src: '' } }] } } as never] });
  const l4 = JSON.stringify(ed.doc.layers[4]);
  const r = applyCategoriesToProject(ed, custom(), 'apply');
  assert.deepEqual([ed.doc.layers[1].name, ed.doc.layers[1].material], ['Pappel 3 mm Schneiden', 'm1']);
  assert.equal(JSON.stringify(ed.doc.layers[4]), l4, 'image layer untouched');
  assert.ok(r.skipped.includes(4) && !r.changed.includes(4) && !r.changed.includes(1));
  assert.ok(r.changed.includes(3));
});

test('"Apply to this project" with the built-in defaults changes nothing in a new project', () => {
  stored = null;
  reset();
  const ed = editor();
  const before = JSON.stringify(ed.doc);
  assert.equal(applyToProject(ed, defaultLayerDefaults()), false);
  assert.equal(JSON.stringify(ed.doc), before);
  // A layer that only differs in settings goes back to the category values, a sub-layer goes away
  ed.layer(4).speed = 999;
  ed.layer(4).sub = [defaultSubLayer('fill')];
  assert.equal(applyToProject(ed, defaultLayerDefaults()), true);
  assert.deepEqual(ed.doc.layers[4], normalizeLayer(defaultLayer(4)));
});

test('categoryFrom copies all settings and the type', () => {
  const line = categoryFrom({ ...defaultLayer(1), tabs: { ...defaultLayer(1).tabs, enabled: true } });
  assert.equal(line.type, 'cut');
  assert.equal(line.cut.tabs.enabled, true);
  assert.equal(line.cut.layerType, undefined);
  assert.equal((line.cut as unknown as Record<string, unknown>).name, undefined, 'only cut settings');
  assert.equal(categoryFrom(defaultLayer(0)).type, 'engrave');
  const marked = categoryFrom({ ...defaultLayer(1), layerType: 'mark' });
  assert.deepEqual([marked.type, marked.cut.layerType], ['mark', undefined]);
  const both = categoryFrom({ ...defaultLayer(0), sub: [defaultSubLayer('line')] });
  assert.deepEqual([both.type, both.cut.sub?.length], ['cut', 1]);
});

test('sameLayerDefaults and new category ids', () => {
  assert.ok(sameLayerDefaults(defaultLayerDefaults(), sanitizeLayerDefaults({})));
  assert.ok(!sameLayerDefaults(defaultLayerDefaults(), custom()));
  const off = defaultLayerDefaults();
  off.apply = false;
  assert.ok(!sameLayerDefaults(defaultLayerDefaults(), off));
  const ids = new Set(Array.from({ length: 50 }, () => newCategoryId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.ok(!isBuiltinCategory(id));
});

if (failed) {
  console.log(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall layer category tests passed');
