// Tests für Print and Cut (Passermarken, Ausrichten). Aufruf: npm run test:printcut
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, newDevice, pointerGCode } from '../src/gcode';
import { apply, defaultImageLayer, defaultLayer, Mat, mul, Obj, Pt, rotate, translate, scale } from '../src/model';
import { designToMachine, findMarks, fitTransform, machineToDesign, makeMark, markCenter, markPlaces, nextMarkNr } from '../src/printcut';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
const nearPt = (p: Pt, q: Pt, eps = 1e-6) => (near(p.x, q.x, eps), near(p.y, q.y, eps));
const src: Pt[] = [{ x: 20, y: 30 }, { x: 180, y: 30 }, { x: 20, y: 250 }];
const map = (m: Mat, ps: Pt[]) => ps.map((p) => apply(m, p.x, p.y));

await test('Zwei Marken: Verschieben und Drehen werden genau gefunden', () => {
  const T = mul(translate(7, -3), rotate((2 * Math.PI) / 180));
  const f = fitTransform(src.slice(0, 2), map(T, src.slice(0, 2)), 'rigid')!;
  near(f.angle, 2);
  near(f.scale, 1);
  near(f.max, 0);
  nearPt(apply(f.m, 100, 100), apply(T, 100, 100));
  near(f.distRatio!, 1);
});

await test('Zwei Marken, Druck skaliert: rigid meldet die Abweichung, similar gleicht sie aus', () => {
  const T = mul(translate(5, 5), scale(1.02, 1.02));
  const dst = map(T, src.slice(0, 2));
  const r = fitTransform(src.slice(0, 2), dst, 'rigid')!;
  near(r.distRatio!, 1.02);
  assert.ok(r.max > 1);
  const s = fitTransform(src.slice(0, 2), dst, 'similar')!;
  near(s.scale, 1.02);
  near(s.max, 0);
});

await test('Drei Marken: affine gleicht unterschiedlichen Maßstab in x und y und Scherung aus', () => {
  const T: Mat = [1.01, 0.003, -0.004, 0.985, 12, -4];
  const f = fitTransform(src, map(T, src), 'affine')!;
  near(f.max, 0, 1e-9);
  for (let i = 0; i < 6; i++) near(f.m[i], T[i], 1e-9);
});

await test('Messrauschen: Restfehler wird gemeldet, Lösung bleibt nah', () => {
  const T = mul(translate(3, 4), rotate(0.01));
  const dst = map(T, src).map((p, i) => ({ x: p.x + [0.1, -0.05, 0][i], y: p.y + [0, 0.08, -0.1][i] }));
  const f = fitTransform(src, dst, 'rigid')!;
  assert.ok(f.rms > 0 && f.max < 0.2);
  nearPt(apply(f.m, 100, 140), apply(T, 100, 140), 0.15);
});

await test('Zu wenige oder entartete Marken: keine Lösung', () => {
  assert.equal(fitTransform(src.slice(0, 1), src.slice(0, 1), 'rigid'), null);
  assert.equal(fitTransform(src.slice(0, 2), src.slice(0, 2), 'affine'), null);
  const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
  assert.equal(fitTransform(line, line, 'affine'), null);
  assert.equal(fitTransform([{ x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 2, y: 2 }, { x: 2, y: 2 }], 'rigid'), null);
});

await test('Marken: Lage in L-Form, Mitte, Nummern, innerhalb des Betts', () => {
  const bed = { w: 300, h: 200 };
  const p = markPlaces({ x: 50, y: 40, w: 100, h: 80 }, 6, 4, bed);
  assert.deepEqual(p, [{ x: 43, y: 33 }, { x: 157, y: 33 }, { x: 43, y: 127 }]);
  const q = markPlaces({ x: 0, y: 0, w: 300, h: 200 }, 6, 4, bed);
  for (const r of q) assert.ok(r.x >= 0 && r.x <= 300 && r.y >= 0 && r.y <= 200);
  const objs: Obj[] = p.map((c, i) => makeMark(i + 1, c, 6, 0, `M${i + 1}`));
  objs.reverse();
  assert.deepEqual(findMarks(objs).map((o) => o.reg), [1, 2, 3]);
  assert.equal(nextMarkNr(objs), 4);
  nearPt(markCenter(objs[2])!, { x: 43, y: 33 }, 1e-6);
  objs[0].m = mul(translate(10, 0), mul(objs[0].m, rotate(0.3)));
  nearPt(markCenter(objs[0])!, { x: 43 + 10, y: 127 }, 1e-6);
});

await test('Maschinen- und Design-Koordinaten', () => {
  nearPt(machineToDesign(10, 20, 300), { x: 10, y: 280 });
  nearPt(designToMachine({ x: 10, y: 280 }, 300), { x: 10, y: 20 });
});

await test('Passermarken werden nicht gelasert', async () => {
  const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false };
  const layer = (i: number) => defaultLayer(i);
  const rect: Obj = { id: 900, m: [1, 0, 0, 1, 50, 50], layer: 0, shape: { kind: 'rect', w: 20, h: 10, r: 0 } };
  const mark = makeMark(1, { x: 10, y: 10 }, 6, 0, 'M');
  const doc = { bed: { w: 200, h: 200 }, objs: [rect, mark] } as never;
  const job = await buildJob({ doc, layer, imgLayer: () => defaultImageLayer(), device, only: null, position: null, forPreview: false });
  assert.ok(job.bounds);
  assert.ok(job.bounds!.x0 >= 49.9, `Job beginnt bei ${job.bounds!.x0}`);
});

await test('Laserpunkt je Firmware', () => {
  const d = newDevice({ fw: 'fluidnc' });
  d.sMax = 1000;
  assert.deepEqual(pointerGCode(d, true, 1), ['G1 F1000', 'M3 S10']);
  assert.deepEqual(pointerGCode(d, false, 1), ['M5']);
  assert.deepEqual(pointerGCode(d, true, 50), ['G1 F1000', 'M3 S100'], 'höchstens 10 %');
  d.fw = 'marlin';
  d.sMax = 255;
  assert.equal(pointerGCode(d, true, 2)[0].startsWith('M3 S'), true);
  d.fw = 'smoothie';
  assert.deepEqual(pointerGCode(d, true, 1), ['fire 1']);
  assert.deepEqual(pointerGCode(d, false, 1), ['fire off']);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Print-and-Cut-Tests bestanden');
