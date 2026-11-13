// Tests für den Fokustest (Rampe, Z-Reihe). Aufruf: npm run test:focus
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { buildJob, estimate, newDevice, writeGCode } from '../src/gcode';
import { defaultImageLayer } from '../src/model';
import {
  buildFocusDoc, cleanFocusOptions, defaultFocusOptions, rampHeight, rampResult, rampTicks, signed, zMoveFor, zResult, zValues,
} from '../src/focustest';

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

const bed = { w: 400, h: 300 };

await test('Rampe: Höhe wächst linear, Markierungen mit Anfang und Ende', () => {
  const o = { ...defaultFocusOptions(), rampLength: 100, rampRise: 8, tickEvery: 10 };
  assert.equal(rampHeight(o, 0), 0);
  assert.equal(rampHeight(o, 50), 4);
  assert.equal(rampHeight(o, 100), 8);
  assert.equal(rampHeight(o, 150), 8);
  assert.deepEqual(rampTicks(o), [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  // Restabschnitt unter einem Viertel: letzte Zwischenmarke entfällt, damit die Zahlen nicht kollidieren
  assert.deepEqual(rampTicks({ ...o, rampLength: 42 }), [0, 10, 20, 30, 42]);
});

await test('Rampe: eine Linie auf Layer 0, Markierungen und Zahlen auf Layer 1', () => {
  const o = { ...defaultFocusOptions(), rampLength: 100, tickEvery: 25, x: 20, y: 30 };
  const t = buildFocusDoc(o, bed, 'Arial');
  assert.equal(t.layers.length, 2);
  assert.equal(t.layers[0].mode, 'line');
  assert.equal(t.layers[0].speed, o.speed);
  const main = t.doc.objs.filter((ob) => ob.layer === 0);
  assert.equal(main.length, 1);
  const sh = main[0].shape;
  assert.equal(sh.kind, 'path');
  if (sh.kind !== 'path') return;
  const [a, b] = sh.subs[0].nodes;
  // Linie beginnt bei X = 20, Maschinen-Y = Bett − Dokument-Y liegt über der unteren Kante y = 30
  assert.equal(a.x + main[0].m[4], 20);
  assert.equal(b.x - a.x, 100);
  const yMachine = bed.h - (a.y + main[0].m[5]);
  assert.ok(yMachine > 30, `Linie bei Y ${yMachine}`);
  // 5 Markierungen (0, 25, 50, 75, 100) + 5 Zahlen + Einheit
  assert.equal(t.doc.objs.filter((ob) => ob.layer === 1).length, 11);
  assert.ok(Math.abs(bed.h - t.bounds.y - t.bounds.h - 30) < 1e-9, 'untere Kante bei Y 30');
});

await test('Z-Reihe: Werte gleichmäßig, je Linie ein Layer mit Z-Versatz', () => {
  const o = { ...defaultFocusOptions(), method: 'z' as const, zFrom: -2, zTo: 2, zCount: 9, labels: false };
  assert.deepEqual(zValues(o), [-2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2]);
  const t = buildFocusDoc(o, bed, 'Arial');
  assert.equal(t.layers.length, 9);
  assert.deepEqual(t.layers.map((L) => L.zOffset), zValues(o));
  assert.deepEqual(t.layers.map((L) => L.priority), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

await test('Z-Reihe: G-Code fährt Z relativ je Linie und am Ende zurück', async () => {
  const o = { ...defaultFocusOptions(), method: 'z' as const, zFrom: -1, zTo: 1, zCount: 3, labels: false };
  const t = buildFocusDoc(o, bed, 'Arial');
  const device = { ...newDevice({ fw: 'fluidnc' }), startFrom: 'absolute' as const, returnHome: false, zAxis: true, optInnerFirst: false, optTravel: false };
  const job = await buildJob({ doc: t.doc, layer: (i) => t.doc.layers[i], imgLayer: () => defaultImageLayer(), device });
  assert.equal(job.warnings.length, 0, job.warnings.join('; '));
  const g = writeGCode(job, device, estimate(job.moves, device)).lines;
  const zs = g.filter((l) => /^G0 Z/.test(l));
  // −1 (Kopf hoch: +1), dann +1 tiefer (−1), dann +1 tiefer (−1), zurück (+1)
  assert.deepEqual(zs, ['G0 Z1', 'G0 Z-1', 'G0 Z-1', 'G0 Z1']);
  // ohne Z-Achse: übersprungen mit Warnung
  const noZ = await buildJob({ doc: t.doc, layer: (i) => t.doc.layers[i], imgLayer: () => defaultImageLayer(), device: { ...device, zAxis: false } });
  assert.equal(noZ.warnings.length, 1);
});

await test('Ergebnisse und Z-Fahrt', () => {
  const o = { ...defaultFocusOptions(), rampLength: 100, rampRise: 10 };
  // Texte hängen von der Sprache ab: nur Zahlen und Unterschiede prüfen
  assert.match(rampResult(o, 30), /\b3 mm/);
  const ends = new Set([rampResult(o, 0), rampResult(o, 100), rampResult(o, 50)]);
  assert.equal(ends.size, 3);
  assert.doesNotMatch(rampResult(o, 0), /\d mm/);
  assert.notEqual(zResult(1.5), zResult(-1.5).replace('−', '+'));
  assert.match(zResult(1.5), /1[.,]5 mm/);
  assert.doesNotMatch(zResult(0), /\d/);
  assert.equal(zMoveFor(1.5, false), -1.5);
  assert.equal(zMoveFor(1.5, true), 1.5);
  assert.match(signed(0.5), /^\+0[.,]5$/);
  assert.equal(signed(-1), '−1');
  assert.equal(signed(0), '0');
});

await test('Gespeicherte Einstellungen werden begrenzt und aufgefüllt', () => {
  const o = cleanFocusOptions({ method: 'x', zCount: 500, power: -5, speed: 'schnell' });
  assert.equal(o.method, 'ramp');
  assert.equal(o.zCount, 41);
  assert.equal(o.power, 0);
  assert.equal(o.speed, defaultFocusOptions().speed);
  assert.deepEqual(cleanFocusOptions(null), defaultFocusOptions());
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
