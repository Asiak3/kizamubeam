// Tests für Strichcodes (1D-Barcodes). Aufruf: npm run test:barcode
// Die erwarteten Bitfolgen stammen von python-barcode (unabhängige Implementierung); bei ITF mit Breitenverhältnis 1:3.
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
const g = globalThis as Record<string, unknown>;
g.Path2D ??= class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} };
const { bars, encodeLinear, gs1Check, LINEAR_TYPES } = await import('../src/barcode1d');
const { barcodeExtent, barcodeOutline, linearSubs } = await import('../src/barcode');
const { buildJob, newDevice } = await import('../src/gcode');
const { defaultImageLayer, defaultLayer, loadDoc } = await import('../src/model');
type BarcodeShape = import('../src/model').BarcodeShape;
type LinearType = import('../src/model').LinearType;

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

/** Bitfolge („1“ = Strichmodul) eines Codes */
function bitsOf(type: LinearType, data: string, check = false): string {
  const r = encodeLinear(type, data, check);
  if (!r.ok) throw new Error(r.error);
  return r.code.runs.map((w, i) => (i % 2 ? '0' : '1').repeat(w)).join('');
}

const EXPECTED: [LinearType, string, boolean, string][] = [
  ['ean13', '400638133393', false, '10100011010100111010111101111010001001011001101010100001010000101000010111010010000101100110101'],
  ['ean8', '9638507', false, '1010001011010111101111010110111010101001110111001010001001011100101'],
  ['upca', '03600029145', false, '10100011010111101010111100011010001101000110101010110110011101001100110101110010011101101100101'],
  ['code39', 'CODE-39', false, '10001011101110101110111010001010111010111010001010101110001011101110101110001010100010101110111011101110001010101011100010111010100010111011101'],
  ['code39', 'CODE-39', true, '100010111011101011101110100010101110101110100010101011100010111011101011100010101000101011101110111011100010101010111000101110101011101110100010100010111011101'],
  ['itf', '1234567890', false, '101011101000101011100011101110100010100011101000111000101010001010111000111010111010001110001011101'],
  ['code128', 'Wikipedia', false, '11010010000111010001101000011010011000010010100001101001010011110010110010000100001001101000011010010010110000111100100101100011101011'],
  ['code128', '12345678', false, '1101001110010110011100100010110001110001011011000010100100011101101100011101011'],
  ['code128', 'AB1234567890cd', false, '110100100001010001100010001011000101110111101011001110010001011000111000101101100001010011011110110101111011101000010110010000100110100010011001100011101011'],
  ['code128', 'ABC123456', false, '1101001000010100011000100010110001000100011010111011110101100111001000101100011100010110111011011101100011101011'],
  ['code128', 'X1234', false, '1101001000011100010110101110111101011001110010001011000101110011001100011101011'],
];

for (const [type, data, check, bits] of EXPECTED)
  await test(`${type} „${data}“${check ? ' mit Prüfziffer' : ''}`, () => assert.equal(bitsOf(type, data, check), bits));

await test('Prüfziffern nach GS1', () => {
  assert.equal(gs1Check('400638133393'), 1);
  assert.equal(gs1Check('9638507'), 4);
  assert.equal(gs1Check('03600029145'), 2);
  assert.equal(gs1Check('1540014128876'), 3); // ITF-14
});

await test('EAN-13 mit Prüfziffer und Bindestrichen', () => {
  assert.equal(bitsOf('ean13', '4006381333931'), EXPECTED[0][3]);
  assert.equal(bitsOf('ean13', '400-638133393'), EXPECTED[0][3]);
  const r = encodeLinear('ean13', '4006381333932');
  assert.ok(!r.ok && /1/.test(r.error), 'falsche Prüfziffer wird gemeldet');
});

await test('ungültige Inhalte werden gemeldet', () => {
  assert.ok(!encodeLinear('ean13', '12345').ok);
  assert.ok(!encodeLinear('ean8', 'ABCDEFG').ok);
  assert.ok(!encodeLinear('code39', 'abc*').ok);
  assert.ok(!encodeLinear('code128', 'Grüße').ok);
  assert.ok(!encodeLinear('itf', '12A4').ok);
  for (const tp of LINEAR_TYPES) assert.ok(!encodeLinear(tp, '').ok);
});

await test('Code 39 mit Kleinbuchstaben wird groß kodiert', () => assert.equal(bitsOf('code39', 'code-39'), EXPECTED[3][3]));

await test('ITF mit ungerader Anzahl bekommt eine führende 0, ITF-14 mit Prüfziffer', () => {
  const r = encodeLinear('itf', '123');
  assert.ok(r.ok && r.code.value === '0123');
  const r14 = encodeLinear('itf', '1540014128876', true);
  assert.ok(r14.ok && r14.code.value === '15400141288763');
});

await test('Code 128: Steuerzeichen über Zeichensatz A, Prüfsumme stimmt', () => {
  const r = encodeLinear('code128', 'A\tb');
  assert.ok(r.ok);
  // Jedes Zeichen 11 Module, Stopp 13
  assert.equal((r.code.total - 13) % 11, 0);
});

await test('Jedes Code-128-Zeichen hat 11 Module, Code 128 beginnt mit Strich und endet mit Strich', () => {
  for (const s of ['a', 'Z9', '000000', 'abc123456def', '\x01\x02x']) {
    const r = encodeLinear('code128', s);
    assert.ok(r.ok, s);
    assert.equal(r.code.runs.length % 2, 1, 'ungerade Anzahl: Strich am Anfang und Ende');
  }
});

await test('EAN-Begrenzungszeichen sind markiert', () => {
  const r = encodeLinear('ean13', '400638133393');
  assert.ok(r.ok);
  const g = bars(r.code).filter((b) => b[2]);
  assert.equal(g.length, 6); // je zwei Striche links, Mitte, rechts
  assert.equal(r.code.text.length, 13);
});

const shape = (o: Partial<BarcodeShape> = {}): BarcodeShape => ({
  kind: 'barcode', type: 'ean13', data: '400638133393', ec: 'M', size: 37.29, height: 20, text: false, check: false, bwr: 0, invert: false, quiet: 11, ...o,
});

await test('Umrisse: ein Rechteck je Strich, Breite und Höhe stimmen', () => {
  const s = shape();
  const ol = barcodeOutline(s);
  assert.equal(ol.n, 95);
  assert.equal(ol.subs.length, 30); // EAN-13: 30 Striche
  const xs = ol.subs.flatMap((sp) => sp.nodes.map((n) => n.x));
  assert.ok(Math.abs(Math.min(...xs)) < 1e-9 && Math.abs(Math.max(...xs) - 37.29) < 1e-9);
  const e = barcodeExtent(s);
  assert.deepEqual([e.x0, e.y0, e.x1, e.y1].map((v) => +v.toFixed(6)), [0, 0, 37.29, 20]);
});

await test('Strichbreitenkorrektur macht Striche schmaler, bei Negativ breiter', () => {
  const w = (s: BarcodeShape, i: number) => {
    const n = barcodeOutline(s).subs[i].nodes;
    return n[1].x - n[0].x;
  };
  const k = 37.29 / 95;
  assert.ok(Math.abs(w(shape(), 0) - k) < 1e-9);
  assert.ok(Math.abs(w(shape({ bwr: 0.1 }), 0) - (k - 0.1)) < 1e-9);
  // Negativ: erster Umriss ist der gelaserte Hintergrund, die Striche sind Löcher
  const inv = shape({ invert: true, bwr: 0.1 });
  const ol = barcodeOutline(inv);
  assert.equal(ol.subs.length, 31);
  assert.ok(Math.abs(w(inv, 1) - (k + 0.1)) < 1e-9);
  assert.ok(ol.ext.x0 <= -11 * k + 1e-9 && ol.ext.x1 >= 37.29 + 11 * k - 1e-9);
});

await test('ungültiger Inhalt: Platzhalter-Rechteck in voller Größe', () => {
  const ol = barcodeOutline(shape({ data: '123' }));
  assert.equal(ol.n, 0);
  assert.equal(ol.subs.length, 1);
});

await test('Klartext: Ziffern unter den Strichen, Begrenzungszeichen verlängert, erste Ziffer links daneben', () => {
  const font = opentype.parse(new Uint8Array(readFileSync('node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff')).buffer);
  const s = shape({ text: true });
  const r = encodeLinear('ean13', s.data);
  assert.ok(r.ok);
  const { subs, ext } = linearSubs(s, r.code, font);
  assert.ok(subs.length > 30 + 13, 'Ziffern als Umrisse');
  const guard = subs[0].nodes,
    normal = subs[2].nodes;
  assert.ok(Math.max(...guard.map((n) => n.y)) > Math.max(...normal.map((n) => n.y)), 'Begrenzungszeichen länger');
  assert.ok(ext.x0 < 0, 'erste Ziffer links der Striche');
  assert.ok(ext.y1 > 20, 'Klartext unter den Strichen');
  // Code 128: Klartext wird auf die Breite der Striche verkleinert
  const c = encodeLinear('code128', 'Ein ziemlich langer Inhalt 1234567890');
  assert.ok(c.ok);
  const cs = { ...s, type: 'code128' as const, size: 30 };
  const out = linearSubs(cs, c.code, font);
  assert.ok(out.ext.x0 > -0.5 && out.ext.x1 < 30.5, 'Text nicht breiter als der Code');
});

await test('Job enthält den Strichcode, Datei mit Strichcode lädt', async () => {
  const doc = loadDoc({
    version: 2, bed: { w: 400, h: 400 }, page: 0, layers: {},
    pages: [{ name: 'S', objs: [{ id: 1, m: [1, 0, 0, 1, 50, 50], layer: 1, shape: shape({ type: 'code128', data: 'ABC-123', size: 30 }) }] }],
  });
  const job = await buildJob({ doc, layer: (i) => defaultLayer(i), imgLayer: () => defaultImageLayer(), device: newDevice({ fw: 'fluidnc' }), only: null, position: null, forPreview: false });
  assert.ok(job.moves.n > 50);
  assert.ok(job.travel && job.travel.x0 >= 50 - 1e-6 && job.travel.x1 <= 80 + 1e-6);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Strichcode-Tests bestanden');
