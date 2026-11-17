// Tests für „Schlitze an Materialdicke anpassen“. Aufruf: npm run test:slots
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import type { Mat, Obj, Shape, SubPath } from '../src/model';
const { IDENT, translate, rotate, mul, visibleLeaves } = await import('../src/model');
const { findSlots, resizeSlots, slotWidths } = await import('../src/slots');
const { buildGen, defaultParams, getGenerator } = await import('../src/generators/index');
await import('./builtin-generators');
const { shapeSubs } = await import('../src/geom');

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

let id = 1;
const obj = (shape: Shape, m: Mat = IDENT): Obj => ({ id: id++, m, layer: 1, shape });
const poly = (pts: [number, number][]): SubPath => ({ closed: true, nodes: pts.map(([x, y]) => ({ x, y })) });
const items = (objs: Obj[]) => [...visibleLeaves(objs)];
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Platte 100×60 mit Kerbe von oben (Breite w, Tiefe 30) bei x = 50 */
const notched = (w: number) =>
  poly([[0, 0], [50 - w / 2, 0], [50 - w / 2, 30], [50 + w / 2, 30], [50 + w / 2, 0], [100, 0], [100, 60], [0, 60]]);

test('Kerbe vom Rand: erkannt und auf 4 mm verbreitert, mittig', () => {
  const o = obj({ kind: 'path', subs: [notched(3)] });
  const s = findSlots(items([o]), { width: 3, tol: 0.3 });
  assert.equal(s.length, 1);
  assert.equal(s[0].hole, false);
  near(s[0].width, 3);
  near(s[0].depth, 30);
  resizeSlots(s, 1);
  const n = (o.shape as { subs: SubPath[] }).subs[0].nodes;
  near(n[1].x, 48); near(n[1].y, 0); near(n[2].x, 48); near(n[2].y, 30);
  near(n[3].x, 52); near(n[4].x, 52); near(n[4].y, 0);
  near(n[5].x, 100);
  const again = findSlots(items([o]), { width: 4, tol: 0.05 });
  assert.equal(again.length, 1);
});

test('Durchbruch als eigenes Rechteck in einer Platte bleibt Rechteck', () => {
  const plate = obj({ kind: 'rect', w: 100, h: 60, r: 0 });
  const hole = obj({ kind: 'rect', w: 3.1, h: 20, r: 0 }, translate(40, 20));
  const s = findSlots(items([plate, hole]), { width: 3, tol: 0.3 });
  assert.equal(s.length, 1);
  assert.equal(s[0].leaf, hole);
  assert.equal(s[0].hole, true);
  resizeSlots(s, 1);
  assert.equal(hole.shape.kind, 'rect');
  near((hole.shape as { w: number }).w, 4.1);
  near(hole.m[4], 39.5);
  near((hole.shape as { h: number }).h, 20);
});

test('Durchbruch im selben Pfad, gedreht', () => {
  const o = obj({ kind: 'path', subs: [poly([[0, 0], [80, 0], [80, 50], [0, 50]]), poly([[20, 10], [20, 40], [23, 40], [23, 10]])] }, mul(translate(100, 100), rotate(0.5)));
  const s = findSlots(items([o]), { width: 3, tol: 0.2 });
  assert.equal(s.length, 1);
  resizeSlots(s, -0.5);
  const n = (o.shape as { subs: SubPath[] }).subs[1].nodes;
  near(n[0].x, 20.25); near(n[2].x, 22.75); near(n[0].y, 10); near(n[1].y, 40);
});

test('Keine Schlitze: Fingerzinken-Lücke, Materialstreifen, Lücke zwischen zwei Teilen', () => {
  // Lücke 3 breit, 3 tief (Zinken) → keine Platte steckt darin
  const finger = obj({ kind: 'path', subs: [poly([[0, 0], [10, 0], [10, 3], [13, 3], [13, 0], [40, 0], [40, 20], [0, 20]])] });
  const strip = obj({ kind: 'rect', w: 3, h: 30, r: 0 }, translate(200, 0));
  const a = obj({ kind: 'rect', w: 20, h: 30, r: 0 }, translate(300, 0));
  const b = obj({ kind: 'rect', w: 20, h: 30, r: 0 }, translate(323, 0));
  assert.equal(findSlots(items([finger, strip, a, b]), { width: 3, tol: 0.3 }).length, 0);
});

test('Schlitzbreiten erkennen: häufigste zuerst', () => {
  const o = obj({ kind: 'path', subs: [notched(3.1)] });
  const o2 = obj({ kind: 'path', subs: [notched(3.1)] }, translate(0, 100));
  const o3 = obj({ kind: 'path', subs: [notched(6)] }, translate(0, 200));
  const w = slotWidths(findSlots(items([o, o2, o3])));
  assert.deepEqual(w, [{ width: 3.1, count: 2 }, { width: 6, count: 1 }]);
});

test('Steckregal als Pfade (wie nach SVG-Import): alle Kreuzschlitze erkannt und passen nach Anpassung zur neuen Dicke', () => {
  const g = getGenerator('shelf')!;
  const mk = (th: number) => buildGen(g, { ...defaultParams(g), thickness: th, play: 0.1, kerf: 0 });
  const r3 = mk(3), r4 = mk(4);
  const toObjs = (r: ReturnType<typeof mk>) => r.parts.map((p, i) => obj({ kind: 'path', subs: shapeSubs(p.shape) }, translate(i * 500, 0)));
  const objs3 = toObjs(r3);
  const found = findSlots(items(objs3), { width: 3.1, tol: 0.05 });
  const count4 = findSlots(items(toObjs(r4)), { width: 4.1, tol: 0.05 }).length;
  assert.ok(found.length > 0);
  assert.equal(found.length, count4);
  resizeSlots(found, 1);
  assert.equal(findSlots(items(objs3), { width: 4.1, tol: 0.01 }).length, count4);
  assert.equal(findSlots(items(objs3), { width: 3.1, tol: 0.05 }).length, 0);
});

test('Einsatz mit Fächern: Halbschlitze erkannt; Box mit Fingerzinken: keine Schlitze', () => {
  const asObjs = (gid: string, th: number) => {
    const g = getGenerator(gid)!;
    const r = buildGen(g, { ...defaultParams(g), thickness: th, kerf: 0, ...(gid === 'insert' ? { play: 0.1 } : { clearance: 0 }) });
    return r.parts.map((p, i) => obj({ kind: 'path', subs: shapeSubs(p.shape) }, translate(i * 500, 0)));
  };
  const ins = asObjs('insert', 3);
  const n = findSlots(items(ins), { width: 3.1, tol: 0.05 }).length;
  assert.ok(n > 0);
  assert.equal(n, findSlots(items(asObjs('insert', 4)), { width: 4.1, tol: 0.05 }).length);
  assert.equal(findSlots(items(asObjs('box', 3)), { width: 3, tol: 0.3 }).length, 0);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Tests bestanden');
