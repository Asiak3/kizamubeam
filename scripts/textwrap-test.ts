// Tests für Textrahmen mit Zeilenumbruch. Aufruf: npm run test:textwrap
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import opentype from 'opentype.js';
const g = globalThis as Record<string, unknown>;
g.Path2D ??= class { moveTo() {} lineTo() {} bezierCurveTo() {} closePath() {} addPath() {} };
const { fitText, textLines, wrapParagraph } = await import('../src/fonts');
type TextShape = import('../src/model').TextShape;

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

// Jedes Zeichen 1 mm breit
const mono = (s: string) => [...s].length;

await test('Umbruch an Wortgrenzen, Leerzeichen am Umbruch entfallen', () => {
  assert.deepEqual(wrapParagraph('Ein kurzer Satz zum Testen', 10, mono), ['Ein kurzer', 'Satz zum', 'Testen']);
  assert.deepEqual(wrapParagraph('passt', 10, mono), ['passt']);
  assert.deepEqual(wrapParagraph('', 10, mono), ['']);
  assert.deepEqual(wrapParagraph('a   b', 3, mono), ['a', 'b']);
});

await test('Einrückung bleibt, zu lange Wörter werden getrennt', () => {
  assert.deepEqual(wrapParagraph('  ab cd', 5, mono), ['  ab', 'cd']);
  assert.deepEqual(wrapParagraph('Donaudampfschiff ja', 6, mono), ['Donaud', 'ampfsc', 'hiff', 'ja']);
  assert.deepEqual(wrapParagraph('x Donaudampf', 6, mono), ['x', 'Donaud', 'ampf']);
  // Breite unter einem Zeichen: jedes Zeichen eine Zeile, keine Endlosschleife
  assert.deepEqual(wrapParagraph('abc', 0.5, mono), ['a', 'b', 'c']);
});

const font = opentype.parse(new Uint8Array(readFileSync('node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff')).buffer);
const text = (extra: Partial<TextShape>): TextShape => ({
  kind: 'text', text: 'Der schnelle braune Fuchs springt über den faulen Hund', font: 'Roboto', size: 5,
  bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0, ...extra,
});

await test('Textrahmen: alle Zeilen passen in die Breite, keine Stauchung', () => {
  const ls = textLines(text({ fit: 'wrap', maxW: 40 }), font);
  assert.ok(ls.length > 1, `${ls.length} Zeilen`);
  for (const l of ls) {
    assert.ok(l.w <= 40 + 1e-9, `Zeile „${l.text}“ ist ${l.w} mm breit`);
    assert.equal(l.sx, 1);
  }
  assert.equal(ls.map((l) => l.text).join(' '), text({}).text);
  // Zeilen mit festem Abstand untereinander
  ls.forEach((l, i) => assert.equal(l.y, i * 5 * 1.2));
});

await test('Ohne Umbruch bleibt die Höchstbreite eine Stauchung', () => {
  const ls = textLines(text({ maxW: 40 }), font);
  assert.equal(ls.length, 1);
  assert.ok(ls[0].sx < 1);
});

await test('Absätze bleiben erhalten, Ausrichtung rechts', () => {
  const ls = textLines(text({ text: 'Erste Zeile\nZweite', fit: 'wrap', maxW: 200, align: 'right' }), font);
  assert.deepEqual(ls.map((l) => l.text), ['Erste Zeile', 'Zweite']);
  for (const l of ls) assert.ok(Math.abs(l.x + l.w) < 1e-9);
});

await test('Textrahmen mit Höchsthöhe: Schrift wird kleiner, bis der Block passt', () => {
  const t = text({ fit: 'wrap', maxW: 40, maxH: 12 });
  const f = fitText(t, font);
  assert.ok(f.size < 5);
  assert.equal(f.maxW, 40);
  const ls = textLines(t, font);
  const h = (ls.length - 1) * f.size * 1.2 + f.size;
  assert.ok(h <= 12 + 1e-9, `Höhe ${h}`);
  for (const l of ls) assert.ok(l.w <= 40 + 1e-9);
});

if (failed) {
  console.log(`${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('Alle Tests bestanden');
