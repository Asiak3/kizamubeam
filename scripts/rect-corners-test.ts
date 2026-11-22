// Tests für individuelle Rechteck-Eckenradien (Modell, Migration, Geometrie, Befehle).
// Aufruf: npm run test:rect-corners
import { strict as assert } from 'node:assert';
import { clampRectCorners, isRectSynced, loadDoc, newDoc, normalizeRect, rectCorners } from '../src/model';
import type { RectShape } from '../src/model';
import { shapeSubs } from '../src/geom';
import { Editor } from '../src/editor';

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

const K = 0.5522847498;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

function stubEditor(sel: never[] | { shape: { kind: string } }[]): Editor {
  const ed = Object.create(Editor.prototype) as Editor;
  Object.assign(ed, {
    doc: newDoc(), sel, rectRadius: 0,
    snapshot() {}, touch() {}, emit() {}, saveToolOptions() {},
  });
  return ed;
}

test('rectCorners: ohne corners viermal r, mit corners die vier Werte', () => {
  assert.deepEqual(rectCorners({ r: 3 }), [3, 3, 3, 3]);
  assert.deepEqual(rectCorners({ r: 3, corners: [1, 2, 3, 4] }), [1, 2, 3, 4]);
  assert.ok(isRectSynced({ r: 2 }));
  assert.ok(isRectSynced({ r: 2, corners: [2, 2, 2, 2] }));
  assert.ok(!isRectSynced({ r: 1, corners: [1, 2, 1, 1] }));
});

test('clampRectCorners: auf 0..min(w,h)/2 geklemmt', () => {
  assert.deepEqual(clampRectCorners([5, 5, 5, 5], 10, 4), [2, 2, 2, 2]);
  assert.deepEqual(clampRectCorners([-1, NaN, Infinity, 1], 10, 10), [0, 0, 0, 1]);
  assert.deepEqual(clampRectCorners([1, 1, 1, 1], 0, 10), [0, 0, 0, 0]);
});

test('normalizeRect: einheitliche corners fallen weg, gemischte bleiben (r = erste Ecke)', () => {
  const a = { kind: 'rect', w: 20, h: 10, r: 0, corners: [2, 2, 2, 2] } as unknown as RectShape;
  normalizeRect(a);
  assert.equal(a.corners, undefined);
  assert.equal(a.r, 2);
  const b = { kind: 'rect', w: 20, h: 10, r: 9, corners: [1, 2, 3, 4] } as unknown as RectShape;
  normalizeRect(b);
  assert.deepEqual(b.corners, [1, 2, 3, 4]);
  assert.equal(b.r, 1);
  const c = { kind: 'rect', w: 10, h: 4, r: 5 } as unknown as RectShape;
  normalizeRect(c);
  assert.equal(c.r, 2);
  const d = { kind: 'rect', w: 10, h: 10, r: 1, corners: [1, 2, 3, 9] } as unknown as RectShape;
  normalizeRect(d);
  assert.deepEqual(d.corners, [1, 2, 3, 5]);
});

test('loadDoc: alte Dateien mit nur r bleiben synchron, neue mit corners bleiben erhalten', () => {
  const legacy = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'S1', objs: [{ id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 10, r: 3 } }] }], page: 0, layers: {} });
  const s = legacy.pages[0].objs[0].shape;
  assert.equal(s.kind, 'rect');
  if (s.kind === 'rect') {
    assert.equal(s.corners, undefined);
    assert.deepEqual(rectCorners(s), [3, 3, 3, 3]);
  }
  const modern = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'S1', objs: [{ id: 2, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 1, corners: [1, 2, 3, 4] } }] }], page: 0, layers: {} });
  const m = modern.pages[0].objs[0].shape;
  assert.equal(m.kind, 'rect');
  if (m.kind === 'rect') assert.deepEqual(m.corners, [1, 2, 3, 4]);
  // Ungültige corners fallen auf synchron zurück.
  const broken = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'S1', objs: [{ id: 3, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 2, corners: [1, 2] } }] }], page: 0, layers: {} });
  const bs = broken.pages[0].objs[0].shape;
  if (bs.kind === 'rect') {
    assert.equal(bs.corners, undefined);
    assert.equal(bs.r, 2);
  }
  // Gruppe wird mitmigriert.
  const g = loadDoc({ version: 2, bed: { w: 400, h: 400 }, pages: [{ name: 'S1', objs: [{ id: 4, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'group', children: [{ id: 5, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 8, h: 8, r: 9 } }] } }] }], page: 0, layers: {} });
  const child = (g.pages[0].objs[0].shape as { kind: 'group'; children: { shape: RectShape }[] }).children[0].shape;
  assert.equal(child.r, 4);
});

test('shapeSubs: r=0 gibt vier scharfe Ecken', () => {
  const subs = shapeSubs({ kind: 'rect', w: 20, h: 10, r: 0 });
  assert.equal(subs.length, 1);
  assert.deepEqual(subs[0].nodes.map((n) => [n.x, n.y]), [[0, 0], [20, 0], [20, 10], [0, 10]]);
});

test('shapeSubs: einheitlicher Radius wie bisher (8 Knoten, gleiche Handles)', () => {
  const subs = shapeSubs({ kind: 'rect', w: 20, h: 20, r: 4 });
  const n = subs[0].nodes;
  assert.equal(n.length, 8);
  const k = 4 * K;
  assert.deepEqual([n[0].x, n[0].y], [4, 0]);
  assert.deepEqual([n[0].cin!.x, n[0].cin!.y], [4 - k, 0]);
  assert.deepEqual([n[1].x, n[1].y], [16, 0]);
  assert.deepEqual([n[2].x, n[2].y], [20, 4]);
  // corners-Form muss dasselbe liefern.
  const via = shapeSubs({ kind: 'rect', w: 20, h: 20, r: 4, corners: [4, 4, 4, 4] });
  assert.deepEqual(via[0].nodes.map((x) => [x.x, x.y]), n.map((x) => [x.x, x.y]));
});

test('shapeSubs: nur oben-links rund (5 Knoten, Rest scharf)', () => {
  const subs = shapeSubs({ kind: 'rect', w: 20, h: 20, r: 0, corners: [5, 0, 0, 0] });
  const n = subs[0].nodes;
  assert.equal(n.length, 5);
  const k = 5 * K;
  near(n[0].x, 5); near(n[0].y, 0);
  near(n[0].cin!.x, 5 - k); near(n[0].cin!.y, 0);
  assert.deepEqual([n[1].x, n[1].y], [20, 0]);
  assert.deepEqual([n[2].x, n[2].y], [20, 20]);
  assert.deepEqual([n[3].x, n[3].y], [0, 20]);
  near(n[4].x, 0); near(n[4].y, 5);
  assert.equal(n[1].cin, undefined);
  assert.equal(n[2].cin, undefined);
});

test('updateShapes: voller corners-Tupel setzt Einzelradien, r wird erste Ecke', () => {
  const o = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0 } } as never;
  const ed = stubEditor([o] as never[]);
  (ed as unknown as { updateShapes: (k: string, p: unknown) => void }).updateShapes('rect', { corners: [1, 2, 3, 4] });
  const s = (o as unknown as { shape: RectShape }).shape;
  assert.deepEqual(s.corners, [1, 2, 3, 4]);
  assert.equal(s.r, 1);
});

test('updateShapes: einzelne Ecke (sparse) behält die anderen je Objekt', () => {
  const a = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 1, corners: [1, 1, 1, 1] } } as never;
  const b = { id: 2, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0, corners: [5, 5, 5, 5] } } as never;
  const ed = stubEditor([a, b] as never[]);
  (ed as unknown as { updateShapes: (k: string, p: unknown) => void }).updateShapes('rect', { corners: [9, undefined, undefined, undefined] });
  const sa = (a as unknown as { shape: RectShape }).shape;
  const sb = (b as unknown as { shape: RectShape }).shape;
  // 9 > min(20,20)/2 = 10? Nein: 9 <= 10, bleibt 9.
  assert.deepEqual(sa.corners, [9, 1, 1, 1]);
  assert.deepEqual(sb.corners, [9, 5, 5, 5]);
});

test('updateShapes: gemeinsamer r synchronisiert und setzt den Werkzeug-Default', () => {
  const o = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 20, h: 20, r: 0, corners: [1, 2, 3, 4] } } as never;
  const ed = stubEditor([o] as never[]);
  (ed as unknown as { updateShapes: (k: string, p: unknown) => void }).updateShapes('rect', { r: 3 });
  const s = (o as unknown as { shape: RectShape }).shape;
  assert.equal(s.corners, undefined);
  assert.equal(s.r, 3);
  assert.equal(ed.rectRadius, 3);
});

test('updateShapes: Ecken werden je Objekt auf min(w,h)/2 geklemmt', () => {
  const o = { id: 1, m: [1, 0, 0, 1, 0, 0], layer: 0, shape: { kind: 'rect', w: 10, h: 4, r: 0 } } as never;
  const ed = stubEditor([o] as never[]);
  (ed as unknown as { updateShapes: (k: string, p: unknown) => void }).updateShapes('rect', { corners: [5, 5, 5, 5] });
  const s = (o as unknown as { shape: RectShape }).shape;
  // Limit 2, einheitlich → als r gespeichert.
  assert.equal(s.corners, undefined);
  assert.equal(s.r, 2);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
