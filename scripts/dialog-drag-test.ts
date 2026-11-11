// Tests für verschiebbare Dialoge (src/dialogDrag.ts): npm run test:dialog-drag
import assert from 'node:assert/strict';
import {
  clampDialogPos, fitDialog, loadPositions, loadSizes, positionKey, resetDialogPositions, savePosition, saveSize, sizeKey,
} from '../src/dialogDrag';

const test = (name: string, fn: () => void) => {
  fn();
  console.log('ok', name);
};
const KEY = 'kizamubeam.dialogPos';
const memStore = (init: Record<string, string> = {}) => {
  const m = { ...init };
  return { getItem: (k: string) => m[k] ?? null, setItem: (k: string, v: string) => void (m[k] = v), m };
};

test('Position im Fenster bleibt unverändert', () => {
  assert.deepEqual(clampDialogPos({ x: 100, y: 50 }, 400, 1200, 800), { x: 100, y: 50 });
});

test('Der Titel kann das Fenster nie verlassen', () => {
  assert.deepEqual(clampDialogPos({ x: -500, y: -40 }, 400, 1200, 800), { x: 0, y: 0 });
  assert.deepEqual(clampDialogPos({ x: 5000, y: 5000 }, 400, 1200, 800), { x: 1120, y: 770 });
});

test('Schmaler Dialog: höchstens seine Breite darf überstehen', () => {
  assert.deepEqual(clampDialogPos({ x: 5000, y: 0 }, 50, 1000, 800), { x: 950, y: 0 });
});

test('Ungültige Zahlen fallen auf 0 zurück', () => {
  assert.deepEqual(clampDialogPos({ x: NaN, y: Infinity }, 400, 1200, 800), { x: 0, y: 770 });
});

test('Werkzeuge teilen sich eine Position', () => {
  assert.equal(positionKey(['offset-dialog', 'gen-dialog'], 'Zahnstange erstellen'), 'tools');
  assert.equal(positionKey(['offset-dialog', 'array-dialog', 'joint-dialog'], 'Verbindungen'), 'tools');
  assert.equal(positionKey(['outline-dialog', 'outline-tool-window'], 'Außenkontur'), 'tools');
});

test('Einstellungen teilen sich eine Position', () => {
  for (const c of ['setup-dialog', 'devices-dialog', 'layer-dialog', 'packs-dialog', 'update-dialog']) {
    assert.equal(positionKey([c], 'x'), 'settings', c);
  }
  assert.equal(positionKey(['fluid-dialog', 'fluid-files-dialog'], 'x'), 'settings');
});

test('Große Fenster teilen sich eine Position', () => {
  for (const c of [['preview-dialog'], ['camera-dialog'], ['mt-dialog'], ['tp-dialog'], ['tpl-dialog', 'tpl-library']]) {
    assert.equal(positionKey(c, 'x'), 'large', c.join(' '));
  }
});

test('Übrige Dialoge: eigene Position nach Klassen, unabhängig von Titel und Sprache', () => {
  assert.equal(positionKey(['remote-pair', 'agent-dialog'], 'Koppeln'), 'agent-dialog.remote-pair');
  assert.equal(positionKey(['agent-dialog'], 'KI'), positionKey(['agent-dialog'], 'AI'));
});

test('Geräteeinstellungen behalten ihren eigenen Platz', () => {
  assert.equal(positionKey(['device-dialog'], 'Geräteeinstellungen: E6'), 'device-dialog');
});

test('Dialog ohne Klassen: Titel als Schlüssel', () => {
  assert.equal(positionKey([], ' Tastenkürzel '), '|Tastenkürzel');
});

test('Speichern und Laden je Schlüssel', () => {
  const s = memStore();
  savePosition(s, 'tools', { x: 10.4, y: 20.6 });
  savePosition(s, 'settings', { x: 1, y: 2 });
  assert.deepEqual(loadPositions(s), { tools: { x: 10, y: 21 }, settings: { x: 1, y: 2 } });
});

test('Beschädigter oder fehlender Speicher ergibt keine Positionen', () => {
  assert.deepEqual(loadPositions(null), {});
  assert.deepEqual(loadPositions(memStore({ [KEY]: '{kaputt' })), {});
  assert.deepEqual(loadPositions(memStore({ [KEY]: '{"a":{"x":"1","y":2},"b":{"x":3,"y":4}}' })), { b: { x: 3, y: 4 } });
});

test('Speicher mit Fehler wirft nicht', () => {
  const bad = { getItem: () => null, setItem: () => { throw new Error('voll'); } };
  savePosition(bad, 'a', { x: 1, y: 1 });
});

test('Die Liste bleibt auf 50 begrenzt, die ältesten fallen weg', () => {
  const s = memStore();
  for (let i = 0; i < 80; i++) savePosition(s, `k${i}`, { x: i, y: i });
  const all = loadPositions(s);
  assert.equal(Object.keys(all).length, 50);
  assert.ok(!('k0' in all) && !('k29' in all) && 'k30' in all && 'k79' in all);
});

// ---------- Größe (#230) ----------
const MIN = { w: 820, h: 620 };

test('Gewünschte Größe passt: Größe und Lage bleiben', () => {
  assert.deepEqual(fitDialog({ x: 100, y: 50 }, { w: 1000, h: 900 }, MIN, 1920, 1080), { x: 100, y: 50, w: 1000, h: 900 });
});

test('Nie kleiner als die Standardgröße', () => {
  assert.deepEqual(fitDialog({ x: 100, y: 50 }, { w: 300, h: 200 }, MIN, 1920, 1080), { x: 100, y: 50, w: 820, h: 620 });
});

test('Fenster kleiner: erst rücken, dann schrumpfen', () => {
  // passt durch Verschieben: Größe bleibt
  assert.deepEqual(fitDialog({ x: 1000, y: 400 }, { w: 1000, h: 900 }, MIN, 1920, 1080), { x: 912, y: 172, w: 1000, h: 900 });
  // passt auch verschoben nicht: schrumpft auf das Fenster (mit Rand), auch unter die Standardgröße
  assert.deepEqual(fitDialog({ x: 900, y: 400 }, { w: 1000, h: 900 }, MIN, 800, 600), { x: 8, y: 8, w: 784, h: 584 });
});

test('Fenster wieder groß: gemerkte Größe kehrt zurück', () => {
  const want = { w: 1000, h: 900 };
  const small = fitDialog({ x: 0, y: 0 }, want, MIN, 800, 600);
  const big = fitDialog({ x: small.x, y: small.y }, want, MIN, 1920, 1080);
  assert.deepEqual([big.w, big.h], [1000, 900]);
});

test('Ungültige Zahlen: Standardgröße und Rand', () => {
  assert.deepEqual(fitDialog({ x: NaN, y: Infinity }, { w: NaN, h: 700 }, MIN, 1920, 1080), { x: 8, y: 8, w: 820, h: 700 });
});

test('Größe je Dialog, ohne Gruppen und unabhängig von der Sprache', () => {
  assert.equal(sizeKey(['settings-dialog'], 'Einstellungen'), 'settings-dialog');
  assert.equal(sizeKey(['setup-dialog'], 'x'), 'setup-dialog'); // Position teilt die Gruppe „settings“, die Größe nicht
  assert.notEqual(sizeKey(['setup-dialog'], 'x'), sizeKey(['devices-dialog'], 'x'));
  assert.equal(sizeKey(['gen-dialog', 'offset-dialog'], 'Box'), sizeKey(['offset-dialog', 'gen-dialog'], 'Kiste'));
  assert.equal(sizeKey([], ' Tastenkürzel '), '|Tastenkürzel');
});

test('Größe speichern, laden und vergessen', () => {
  const s = memStore();
  saveSize(s, 'settings-dialog', { w: 1000.4, h: 899.6 });
  saveSize(s, 'gen-dialog.offset-dialog', { w: 700, h: 800 });
  assert.deepEqual(loadSizes(s), { 'settings-dialog': { w: 1000, h: 900 }, 'gen-dialog.offset-dialog': { w: 700, h: 800 } });
  saveSize(s, 'settings-dialog', null);
  assert.deepEqual(loadSizes(s), { 'gen-dialog.offset-dialog': { w: 700, h: 800 } });
  assert.deepEqual(loadPositions(s), {}, 'Größen stehen nicht bei den Positionen');
});

test('Beschädigte Größen werden übergangen', () => {
  assert.deepEqual(loadSizes(null), {});
  assert.deepEqual(loadSizes(memStore({ 'kizamubeam.dialogSize': '{kaputt' })), {});
  assert.deepEqual(loadSizes(memStore({ 'kizamubeam.dialogSize': '{"a":{"w":0,"h":5},"b":{"w":"3","h":4},"c":{"w":3,"h":4}}' })), { c: { w: 3, h: 4 } });
});

test('Zurücksetzen vergisst Positionen und Größen', () => {
  const s = { ...memStore(), removeItem(k: string) { delete this.m[k]; } };
  savePosition(s, 'tools', { x: 1, y: 2 });
  saveSize(s, 'settings-dialog', { w: 900, h: 700 });
  resetDialogPositions(s);
  assert.deepEqual([loadPositions(s), loadSizes(s)], [{}, {}]);
});
