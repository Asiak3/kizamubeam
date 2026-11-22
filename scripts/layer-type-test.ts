// #265: Layer type (cut / engrave / mark). It tells what a layer does to the workpiece; only the 3D view, the assembly
// check (same cutters as the 3D view) and nesting read it. The G-code does not change.
//
// layer-type-fixtures.json records, for the code before the layer type, hashes of the 3D scene, the cutters, the marks
// and the nesting units of a test page (write it again with --write, only on that code). Layers without a type and
// layers of type 'cut' must reproduce it exactly. Aufruf: npm run test:layer-type
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Layer, Obj, SubPath } from '../src/model';
const { loadDoc, defaultLayer, defaultSubLayer, shapeCutsThrough, translate } = await import('../src/model');
const { collectScene } = await import('../src/view3d/panel');
const { collectCutters } = await import('../src/view3d/cuts');
const { looseMarks, pageMarks } = await import('../src/view3d/engrave');
const { EditorNest } = await import('../src/editor/nest');

const FIXTURES = new URL('./layer-type-fixtures.json', import.meta.url);
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

// ---------- Test page ----------
// Layer 0: line (parts), 1: fill (engraving), 2: line (marks, the case of the issue), 3: fill with a line sub-layer
// ("line + fill"), 7: line without output (raw sheet, #326)

type Types = Partial<Record<number, string>>;

function layers(types: Types): Record<number, Layer> {
  const L: Record<number, Layer> = {
    0: { ...defaultLayer(0), mode: 'line' },
    1: { ...defaultLayer(1), mode: 'fill' },
    2: { ...defaultLayer(2), mode: 'line', speed: 3000, power: 15 },
    3: { ...defaultLayer(3), mode: 'fill', sub: [{ ...defaultSubLayer('line'), output: true }] },
    7: { ...defaultLayer(7), mode: 'line', output: false },
  };
  for (const [i, t] of Object.entries(types)) if (t !== undefined) (L[Number(i)] as unknown as Record<string, unknown>).layerType = t;
  return L;
}

const rect = (id: number, layer: number, x: number, y: number, w: number, h: number): Obj => ({ id, m: translate(x, y), layer, shape: { kind: 'rect', w, h, r: 0 } });
const circle = (id: number, layer: number, cx: number, cy: number, r: number): Obj => ({ id, m: translate(cx, cy), layer, shape: { kind: 'ellipse', rx: r, ry: r } });
const sq = (s: number, closed = true): SubPath[] => [{ closed, nodes: [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }] }];
const path = (id: number, layer: number, x: number, y: number, subs: SubPath[], mark?: string): Obj => ({ id, m: translate(x, y), layer, shape: { kind: 'path', subs, ...(mark ? { mark } : {}) } });

function page(): Obj[] {
  return [
    rect(1, 0, 10, 10, 120, 100), // plate
    circle(2, 0, 40, 40, 10), // hole on the cut layer
    circle(3, 2, 90, 40, 10), // closed mark inside the plate
    rect(4, 2, 120, 60, 30, 20), // closed mark across the right edge of the plate
    path(5, 2, 20, 60, sq(15, false)), // open line on the mark layer
    rect(6, 1, 20, 85, 20, 10), // fill engraving
    rect(7, 3, 60, 75, 20, 15), // "line + fill" inside the plate
    path(8, 2, 100, 85, sq(8), 'a/1'), // generator label (closed, marked)
    rect(9, 0, 200, 10, 50, 50), // second plate
    rect(10, 3, 210, 20, 10, 10), // "line + fill" inside the second plate
    rect(11, 7, 150, 120, 100, 60), // raw sheet without output
    rect(12, 0, 160, 130, 20, 20), // part on the raw sheet
    { id: 13, m: translate(300, 150), layer: 2, shape: { kind: 'gen', gen: 'gear', v: 1, params: {}, subs: sq(30) } }, // generator object (gear, pattern fill) on the mark layer
  ];
}

function setup(types: Types) {
  const objs = page();
  const doc = loadDoc({ version: 2, bed: { w: 400, h: 300 }, page: 0, layers: {}, pages: [{ name: 'A', objs }] });
  const L = layers(types);
  const layer = (i: number) => L[i] ?? defaultLayer(i);
  const ed = Object.create(EditorNest.prototype) as InstanceType<typeof EditorNest> & Record<string, unknown>;
  Object.assign(ed, { doc, sel: [] as Obj[], layer });
  return { ed, objs: doc.pages[0].objs, layer };
}

// ---------- What the 3D view, the assembly check and nesting see ----------

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function record(types: Types) {
  const { ed, objs, layer } = setup(types);
  const sc = collectScene(ed as never, 3, false);
  const scene = {
    solids: sc.scene.solids.map((s) => ({ key: s.key, label: s.label, th: s.th, layer: s.layer, polys: s.polys.map((p) => p.map((q) => [r3(q.x), r3(q.y)])) })),
    overlaps: sc.scene.overlaps,
    loose: sc.loose.map((o) => o.id),
    asms: sc.asms,
  };
  const cutters = collectCutters([objs], layer).map((c) => ({ id: c.id, box: c.box }));
  const marks = looseMarks(ed as never, [], new Map()).map((o) => o.id);
  const nest = ed.nestUnits(objs, true).map((u) => u.objs.map((o) => o.id).sort((a, b) => a - b));
  return { scene, cutters, marks, nest };
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const hashes = (r: ReturnType<typeof record>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, hash(v)]));

if (write) {
  writeFileSync(FIXTURES, JSON.stringify(hashes(record({})), null, 1) + '\n');
  console.log('layer-type-fixtures.json written');
  process.exit(0);
}

const fixtures = JSON.parse(readFileSync(FIXTURES, 'utf8')) as Record<string, string>;

// ---------- Compatibility: without a type and with type 'cut' everything stays as before ----------

for (const [name, types] of [
  ['without layer type', {}],
  ['all layers of type cut', { 0: 'cut', 1: 'cut', 2: 'cut', 3: 'cut', 7: 'cut' }],
  ['fill layer of type engrave (a fill never cuts)', { 0: 'cut', 1: 'engrave', 2: 'cut', 7: 'cut' }],
  ['unknown type counts as cut', { 2: 'route' }],
] as [string, Types][])
  test(`compatible: ${name}`, () => assert.deepEqual(hashes(record(types)), fixtures));

// ---------- Mark and engrave layers do not cut ----------

const MARKED: Types = { 0: 'cut', 2: 'mark', 3: 'engrave', 7: 'cut' };

test('cutters: shapes on mark and engrave layers cut nothing', () => {
  const ids = record(MARKED).cutters.map((c) => c.id);
  assert.deepEqual(ids, record({}).cutters.map((c) => c.id).filter((id) => ![3, 4, 7, 10].includes(id)));
  assert.ok(ids.includes(2), 'the hole on the cut layer still cuts');
});

test('3D: the plate keeps only its real hole; marks are neither holes nor notches nor plates', () => {
  const { scene } = record(MARKED);
  const before = record({}).scene;
  const plateOf = (sc: typeof scene) => sc.solids.find((s) => s.polys.some((p) => p.some(([x, y]) => x === 10 && y === 10)))!;
  assert.equal(plateOf(before).polys.length, 4, 'before: outline with a notch plus three holes');
  const plate = plateOf(scene);
  assert.equal(plate.polys.length, 2, 'outline and the hole of object 2');
  assert.ok(plate.polys[0].length === 4, 'the outline has no notch');
  // No solid comes from a shape on a mark or engrave layer, generator objects (pattern fill) included
  assert.ok(!scene.solids.some((s) => s.layer === 3), 'no plate from the line + fill layer');
  assert.ok(!scene.solids.some((s) => s.layer === 2), 'no plate from the mark layer, not even from the generator object');
  assert.ok(record({}).scene.solids.some((s) => s.layer === 2), 'before: the generator object was a plate');
});

test('3D: closed shapes on mark and engrave layers are engraved', () => {
  const marks = record(MARKED).marks;
  for (const id of [3, 4, 5, 6, 7, 8, 10, 13]) assert.ok(marks.includes(id), `object ${id} is an engraving (${marks})`);
  assert.ok(!marks.includes(1) && !marks.includes(2), 'parts and holes are not engravings');
});

test('nesting: marks move with the part they touch or lie in, without grouping', () => {
  const before = record({}).nest;
  assert.ok(before.some((u) => u.length === 1 && u[0] === 4), 'before: the mark across the edge was a part of its own');
  const nest = record(MARKED).nest;
  const unitOf = (id: number) => nest.find((u) => u.includes(id))!;
  assert.deepEqual(unitOf(1), [1, 2, 3, 4, 5, 6, 7, 8], 'plate with hole, marks, engraving, line + fill and label');
  assert.deepEqual(unitOf(9), [9, 10], 'second plate with its line + fill shape');
});

test('generator marks are engraved whole, closed contours included (window frames, digits 0 and 8), whatever the type', () => {
  for (const types of [{}, MARKED] as Types[]) {
    const { ed } = setup(types);
    const kinds = pageMarks(ed as never, 0).filter((mk) => mk.o.id === 8).map((mk) => mk.kind);
    assert.deepEqual(kinds, ['outline'], JSON.stringify(types));
  }
});

test('assembly members stay parts on any layer (the 3D view builds them from the generator)', () => {
  const L = { ...defaultLayer(2), layerType: 'mark' as const };
  const gen = (asm?: string): Obj => ({ id: 1, m: translate(0, 0), layer: 2, shape: { kind: 'gen', gen: 'gear', v: 1, params: {}, subs: sq(30), ...(asm ? { asm } : {}) } });
  assert.equal(shapeCutsThrough(gen('a'), L), true);
  assert.equal(shapeCutsThrough(gen(), L), false);
  assert.equal(shapeCutsThrough(gen('a'), { ...defaultLayer(1), mode: 'fill' }), false, 'a fill layer still cuts nothing');
});

// ---------- Project files and material library ----------

const { cutSettings, normalizeLayer, normalizeCut } = await import('../src/model');
const { sanitizeEntry, parseLibrary, layerPatch, differsFrom, settingsSummary } = await import('../src/materials');

test('older projects: loading and normalizing adds no layer type (they do not show as changed)', () => {
  const old = { version: 2, bed: { w: 400, h: 300 }, page: 0, pages: [{ name: 'A', objs: page() }], layers: { 0: { ...defaultLayer(0) }, 2: { ...defaultLayer(2), sub: [{ ...defaultSubLayer('fill') }] } } };
  const json = JSON.stringify(old);
  const doc = loadDoc(JSON.parse(json));
  for (const L of Object.values(doc.layers)) normalizeCut(normalizeLayer(L));
  assert.ok(!JSON.stringify(doc).includes('layerType'));
  assert.ok(!('layerType' in doc.layers[2].sub![0]), 'sub-layers never carry a type');
});

test('project file keeps the type of a layer', () => {
  const doc = loadDoc({ version: 2, bed: { w: 400, h: 300 }, page: 0, pages: [{ name: 'A', objs: [] }], layers: { 2: { ...defaultLayer(2), layerType: 'mark' } } });
  const again = loadDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(normalizeLayer(again.layers[2]).layerType, 'mark');
});

test('material library: the type is stored and restored; older entries have none', () => {
  assert.ok(!('layerType' in sanitizeEntry({ material: 'Pappel', settings: { mode: 'line' } })!.settings), 'older entry');
  assert.ok(!('layerType' in sanitizeEntry({ material: 'Pappel', settings: { mode: 'line', layerType: 'route' } })!.settings), 'unknown type');
  const L = { ...defaultLayer(2), layerType: 'mark' as const };
  const e = sanitizeEntry({ material: 'Pappel', title: 'Markieren', settings: cutSettings(L) })!;
  assert.equal(e.settings.layerType, 'mark');
  const [back] = parseLibrary(JSON.stringify({ format: 'kizamubeam-materials', version: 2, entries: [e] }));
  assert.equal(back.settings.layerType, 'mark', 'through a library file');
  assert.match(settingsSummary(back.settings), /^Markieren, Linie/);
  assert.match(settingsSummary(defaultLayer(1)), /^Linie/, 'no type, no word');
});

test('material library: an entry without a type leaves the type of the layer; with a type it sets it', () => {
  const L = { ...defaultLayer(2), layerType: 'mark' as const };
  const plain = sanitizeEntry({ material: 'Pappel', settings: cutSettings(defaultLayer(2)) })!;
  const after = { ...L, ...layerPatch(plain) };
  assert.equal(after.layerType, 'mark');
  assert.equal(differsFrom(after, plain), false, 'keeping its own type is no change');
  const engrave = sanitizeEntry({ material: 'Pappel', settings: { ...cutSettings(defaultLayer(2)), layerType: 'engrave' } })!;
  assert.equal(differsFrom(after, engrave), true);
  assert.equal({ ...L, ...layerPatch(engrave) }.layerType, 'engrave');
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Layer-Typ-Tests bestanden');
