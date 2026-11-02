// Tests für den Jig-Generator. Aufruf: npm run test:jig
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildGen, defaultParams, normalizeParams } from '../src/generators';
import { decodeShapes, encodeShapes, JIG, jigLayout, JigParams, JigShape, outlineFromPolys } from '../src/generators/jig';
import { flattenSub } from '../src/clip';
import { IDENT, Pt } from '../src/model';

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
const circle = (cx: number, cy: number, r: number, n = 180): Pt[] => Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * 2 * Math.PI), y: cy + r * Math.sin((i / n) * 2 * Math.PI) }));
const rect = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const ext = (pts: Pt[]) => ({ x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), y0: Math.min(...pts.map((q) => q.y)), y1: Math.max(...pts.map((q) => q.y)) });
const subPts = (sp: Parameters<typeof flattenSub>[0]) => flattenSub(sp, IDENT).map((q) => ({ x: q.X / 1000, y: q.Y / 1000 }));

const disc: JigShape = { n: 'Anhänger', c: 6, r: 0, s: outlineFromPolys([circle(100, 50, 10), circle(100, 42, 2).reverse()]) };
const params = (patch: Partial<JigParams> = {}) => normalizeParams(JIG, { ...defaultParams(JIG), shapes: encodeShapes([disc]), notch: 'none', ...patch }) as unknown as JigParams;

await test('Umriss: Außenkontur zentriert, Loch im Werkstück entfällt', () => {
  assert.equal(disc.s.length, 1);
  const e = ext(subPts(disc.s[0]));
  near(e.x0, -10, 0.03);
  near(e.x1, 10, 0.03);
  near(e.y0, -10, 0.03);
  const two = outlineFromPolys([rect(0, 0, 10, 10), rect(20, 0, 10, 10)]);
  assert.equal(two.length, 2, 'getrennte Teile bleiben getrennt');
  const merged = outlineFromPolys([rect(0, 0, 10, 10), rect(5, 5, 10, 10)]);
  assert.equal(merged.length, 1);
});

await test('Formen speichern und lesen', () => {
  const back = decodeShapes(encodeShapes([disc, { ...disc, n: 'B', c: 2, r: 90 }]));
  assert.equal(back.length, 2);
  assert.equal(back[1].r, 90);
  assert.equal(back[0].c, 6);
  assert.deepEqual(decodeShapes('kaputt'), []);
});

await test('Aussparung: Spiel je Seite, Fuge abgezogen', () => {
  const p = params({ clearance: 0.2, kerf: 0.1, numbers: false, marks: false });
  const lay = jigLayout(p);
  assert.equal(lay.slots.length, 6);
  const e = ext(subPts(lay.holes[0]));
  // Schnittlinie: Radius 10 + 0,2 − 0,05; der Laser nimmt 0,05 dazu → 10,2 je Seite
  near(e.x1 - e.x0, 2 * 10.15, 0.05);
});

await test('Anordnung: Fächer überlappen nicht, liegen in der Platte, Nummern 1 … n', () => {
  const p = params({ clearance: 0.2, gap: 4, margin: 10 });
  const lay = jigLayout(p);
  assert.deepEqual(lay.slots.map((s) => s.nr), [1, 2, 3, 4, 5, 6]);
  for (const a of lay.slots)
    for (const b of lay.slots) if (a !== b) assert.ok(Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) >= 20.2 + 4 - 0.02);
  for (const s of lay.slots) assert.ok(Math.abs(s.c.x) + 10.2 <= lay.w / 2 && Math.abs(s.c.y) + 10.2 <= lay.h / 2);
  assert.equal(lay.markCenters.length, 3);
  assert.ok(lay.numbers.length >= 6);
});

await test('Feste Platte: zu viele Fächer werden gemeldet', () => {
  const p = params({ plate: 'size', width: 60, height: 40, marks: false, numbers: false, margin: 5 });
  const lay = jigLayout(p);
  near(lay.w, 60);
  near(lay.h, 40);
  assert.ok(lay.slots.length >= 1 && lay.slots.length < 6);
  assert.equal(lay.slots.length + lay.overflow, 6);
  const issues = JIG.validate(p as never);
  assert.ok(issues.some((i) => i.level === 'warn'));
});

await test('Mehrere Arten, gedrehte Art, Griffmulden', () => {
  const bar: JigShape = { n: 'Leiste', c: 2, r: 90, s: outlineFromPolys([rect(0, 0, 40, 10)]) };
  const p = params({ shapes: encodeShapes([{ ...disc, c: 3 }, bar]), notch: 'one', notchSize: 10 });
  const lay = jigLayout(p);
  assert.deepEqual(lay.slots.map((s) => s.shape), [0, 0, 0, 1, 1]);
  assert.equal(lay.slots[3].rot, 90);
  // Gedrehte Leiste: Aussparung höher als breit
  const holeOfBar = lay.holes[3];
  const e = ext(subPts(holeOfBar));
  assert.ok(e.y1 - e.y0 > 40 && e.y1 - e.y0 < 40.5, `Höhe ${e.y1 - e.y0}`);
  // Griffmulde verbreitert die Scheibe nach rechts um etwa den Muldenradius
  const d = ext(subPts(lay.holes[0]));
  assert.ok(d.x1 - d.x0 > 20.2 + 4.5, `Breite ${d.x1 - d.x0}`);
});

await test('Generator: ein Teil mit Platte, Aussparungen und Gravur', () => {
  const r = buildGen(JIG, params() as never);
  assert.equal(r.issues.filter((i) => i.level === 'error').length, 0);
  assert.equal(r.parts.length, 1);
  const part = r.parts[0];
  assert.equal(part.shape.subs.length, 7, 'Platte + 6 Aussparungen');
  assert.ok((part.marks?.length ?? 0) > 0);
  const empty = buildGen(JIG, normalizeParams(JIG, { shapes: '[]' }));
  assert.ok(empty.issues.some((i) => i.level === 'error'));
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Jig-Tests bestanden');
